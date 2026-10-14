// Fixed operations only: the browser never supplies SQL, table or column names.
const jsonFields = ['current_track', 'playlist', 'muted_users', 'banned_users', 'playback_state', 'tracks'];
export function decode(row) {
  if (!row) return null;
  const result = { ...row };
  for (const key of jsonFields) {
    if (!(key in result)) continue;
    for (let i = 0; i < 2 && typeof result[key] === 'string'; i++) {
      try { result[key] = JSON.parse(result[key]); } catch { break; }
    }
  }
  if ('is_permanent' in result) result.is_permanent = Boolean(result.is_permanent);
  return result;
}
function id(value) {
  if (typeof value !== 'string' || !value.length || value.length > 160) throw new Error('Invalid identifier');
  return value;
}
function limit(value, fallback) { return Number.isInteger(value) ? Math.max(1, Math.min(100, value)) : fallback; }
const pack = (value, fallback = null) => JSON.stringify(value ?? fallback);

export async function executeData(db, op, args = {}) {
  const now = new Date().toISOString();
  switch (op) {
    case 'loadPlaylist': {
      const row = await db.prepare("SELECT tracks FROM playlists WHERE user_id = ? AND name = 'Default'").bind(id(args.userId)).first();
      return decode(row)?.tracks ?? null;
    }
    case 'savePlaylist':
      if (!Array.isArray(args.tracks) || args.tracks.length > 500) throw new Error('Invalid playlist');
      await db.prepare("INSERT INTO playlists(user_id, name, tracks, updated_at) VALUES (?, 'Default', ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET tracks=excluded.tracks, updated_at=excluded.updated_at")
        .bind(id(args.userId), pack(args.tracks), now).run();
      return true;
    case 'loadActiveRooms': {
      const cutoff = new Date(Date.now() - 120000).toISOString();
      const { results } = await db.prepare('SELECT * FROM rooms WHERE user_count > 0 AND last_active_at > ? ORDER BY user_count DESC LIMIT ?')
        .bind(cutoff, limit(args.limit, 20)).all();
      return results.map(decode);
    }
    case 'loadPermanentRooms': {
      const { results } = await db.prepare('SELECT * FROM rooms WHERE is_permanent = 1 ORDER BY room_id').all();
      return results.map(decode);
    }
    case 'loadInactiveRooms': {
      const { results } = await db.prepare('SELECT * FROM rooms WHERE is_permanent = 0 AND (user_count = 0 OR last_active_at <= ?) ORDER BY last_active_at DESC LIMIT ?')
        .bind(new Date(Date.now() - 120000).toISOString(), limit(args.limit, 10)).all();
      return results.map(decode);
    }
    case 'loadRoom': return decode(await db.prepare('SELECT * FROM rooms WHERE room_id = ?').bind(id(args.roomId)).first());
    case 'saveRoom': {
      const r = args.room;
      if (!r || !Array.isArray(r.playlist) || r.playlist.length > 500) throw new Error('Invalid room');
      const fields = ['room_id', 'host_name', 'host_handle', 'host_avatar', 'host_user_id', 'current_track', 'user_count', 'playlist', 'muted_users', 'banned_users', 'playback_state', 'last_active_at'];
      const values = [id(r.roomId), r.hostName || null, r.hostHandle || null, r.hostAvatar || null, r.hostUserId || null,
        pack(r.currentTrack), Math.max(0, Number(r.userCount) || 0), pack(r.playlist, []), pack(r.mutedUsers, []), pack(r.bannedUsers, []), pack(r.playbackState), now];
      // Permanent status is managed through migrations, never by a browser write.
      const result = await db.prepare(`INSERT INTO rooms(${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')}) ON CONFLICT(room_id) DO UPDATE SET ${fields.slice(1).map(f => `${f}=excluded.${f}`).join(',')} WHERE rooms.host_user_id = excluded.host_user_id`)
        .bind(...values).run();
      if (!result.meta.changes) throw new Error('Invalid room owner');
      return true;
    }
    case 'updateRoomUserCount':
      if (!Number.isInteger(args.userCount) || args.userCount < 0 || args.userCount > 10000) throw new Error('Invalid listener count');
      await db.prepare('UPDATE rooms SET user_count = ?, last_active_at = ? WHERE room_id = ?').bind(args.userCount, now, id(args.roomId)).run();
      return true;
    case 'updateRoomCurrentTrack':
      await db.prepare('UPDATE rooms SET current_track = ?, last_active_at = ? WHERE room_id = ?').bind(pack(args.currentTrack), now, id(args.roomId)).run();
      return true;
    case 'saveChatMessage': {
      const m = args.message;
      if (!m || typeof m.text !== 'string' || m.text.length > 2000 || !Number.isSafeInteger(m.timestamp)) throw new Error('Invalid chat message');
      await db.prepare('INSERT INTO chat_messages(room_id,user_id,handle,name,avatar_url,text,gif_url,preview_url,timestamp) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id(args.roomId), id(m.userId || 'anon'), m.handle || 'Anonymous', m.name || 'Anonymous', m.avatar || null, m.text, m.gifUrl || null, m.previewUrl || null, m.timestamp).run();
      return true;
    }
    case 'loadChatHistory': {
      const { results } = await db.prepare('SELECT * FROM (SELECT * FROM chat_messages WHERE room_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?) ORDER BY timestamp ASC, id ASC')
        .bind(id(args.roomId), limit(args.limit, 50)).all();
      return results.map(r => ({ userId: r.user_id, handle: r.handle, name: r.name, avatar: r.avatar_url, text: r.text, gifUrl: r.gif_url, previewUrl: r.preview_url, timestamp: r.timestamp }));
    }
    default: throw new Error('Unknown operation');
  }
}
