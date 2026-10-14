const { verify, reply, validateRequest } = require('../session.cjs');
const allowed = new Set(['track', 'untrack', 'sync', 'chat', 'track-change', 'song-request', 'request-response', 'kick', 'ban', 'request-state']);
const privileged = new Set(['sync', 'track-change', 'request-response', 'kick', 'ban']);
async function rest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Realtime relay is not configured'), { status: 503 });
  const response = await fetch(`${url}${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Object.assign(new Error('Realtime storage unavailable'), { status: 503 });
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
exports.handler = async event => {
  try {
    validateRequest(event);
    const claims = verify(event.headers?.authorization);
    if (!event.body || Buffer.byteLength(event.body) > 65536) return reply(413, { error: 'Message too large' });
    let body;
    try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }
    const { roomId, event: action, payload } = body || {};
    if (typeof roomId !== 'string' || !/^[a-zA-Z0-9_.-]{1,160}$/.test(roomId) || !allowed.has(action) ||
        !payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(400, { error: 'Invalid room message' });
    const rooms = await rest(`/rest/v1/rooms?room_id=eq.${encodeURIComponent(roomId)}&select=host_user_id,banned_users`);
    const room = rooms[0];
    const isHost = Boolean(claims.audius_user_id) && (room ? room.host_user_id === claims.audius_user_id : roomId === claims.audius_handle);
    if (privileged.has(action) && !isHost) return reply(403, { error: 'Only the room owner may send this command' });
    const user = { userId: claims.audius_user_id || `guest-${claims.sub}`, handle: claims.audius_handle || 'guest',
      name: claims.audius_name, avatar: claims.audius_avatar, verified: claims.audius_verified, isHost };
    let data = { ...payload };
    if (action === 'chat') {
      if (typeof data.text !== 'string' || data.text.length > 2000) return reply(400, { error: 'Invalid chat' });
      if (Array.isArray(room?.banned_users) && room.banned_users.includes(user.userId)) return reply(403, { error: 'User is banned' });
      Object.assign(data, user, { audioBadge: null, timestamp: Date.now() });
    }
    if (action === 'song-request') data.requestedBy = user;
    if (action === 'request-state') data.userId = user.userId;
    let broadcastEvent = action;
    if (action === 'track' || action === 'untrack') {
      const filter = `room_id=eq.${encodeURIComponent(roomId)}&session_id=eq.${claims.jti}`;
      if (action === 'untrack') await rest(`/rest/v1/room_presence?${filter}`, { method: 'DELETE' });
      else await rest('/rest/v1/room_presence?on_conflict=room_id,session_id', { method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ room_id: roomId, session_id: claims.jti,
          profile: user, last_seen: new Date().toISOString() }) });
      const cutoff = encodeURIComponent(new Date(Date.now() - 60000).toISOString());
      const present = await rest(`/rest/v1/room_presence?room_id=eq.${encodeURIComponent(roomId)}&last_seen=gt.${cutoff}&select=profile`);
      data = Object.create(null);
      for (const { profile } of present) (data[profile.userId] ||= []).push(profile);
      await rest(`/rest/v1/rooms?room_id=eq.${encodeURIComponent(roomId)}`, { method: 'PATCH',
        body: JSON.stringify({ user_count: Object.keys(data).length, last_active_at: new Date().toISOString() }) });
      broadcastEvent = 'presence';
      // Bound stale presence storage, including abandoned rooms/sessions.
      await rest(`/rest/v1/room_presence?last_seen=lt.${cutoff}`, { method: 'DELETE' });
    }
    await rest('/realtime/v1/api/broadcast', { method: 'POST', body: JSON.stringify({ messages: [{
      topic: `room:${roomId}`, event: broadcastEvent, private: true, payload: { sender: claims.jti, data },
    }] }) });
    return reply(200, { ok: true });
  } catch (error) { return reply(error.status || 503, { error: error.status ? error.message : 'Realtime service unavailable' }); }
};
