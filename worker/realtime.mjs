import { DurableObject } from 'cloudflare:workers';

const events = new Set(['sync', 'chat', 'track-change', 'song-request', 'request-response', 'kick', 'ban', 'request-state', 'room-announce']);
const hostEvents = new Set(['sync', 'track-change', 'request-response', 'kick', 'ban']);

export class RoomChannel extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.ctx.getWebSockets().length >= 100) return new Response('Room is full', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const channel = new URL(request.url).searchParams.get('channel');
    server.serializeAttachment({ id: crypto.randomUUID(), channel, user: null, window: Date.now(), count: 0 });
    this.send(server, { type: 'presence', state: this.presence() });
    return new Response(null, { status: 101, webSocket: client });
  }
  send(ws, value) {
    try { ws.send(JSON.stringify(value)); } catch { /* close callback updates presence */ }
  }
  peers() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1); }
  presence() {
    const state = Object.create(null);
    for (const ws of this.peers()) {
      const { user } = ws.deserializeAttachment();
      if (user) (state[user.userId] ||= []).push(user);
    }
    return state;
  }
  updatePresence() {
    const message = { type: 'presence', state: this.presence() };
    for (const ws of this.peers()) this.send(ws, message);
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 65536) { ws.close(1009, 'Message too large'); return; }
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    const session = ws.deserializeAttachment();
    if (Date.now() - session.window > 10000) { session.window = Date.now(); session.count = 0; }
    if (++session.count > 60) { ws.close(1008, 'Too many messages'); return; }
    ws.serializeAttachment(session);
    if (message.type === 'track') {
      const u = message.user;
      if (!u || typeof u.userId !== 'string' || u.userId.length > 160 || !u.userId.length) return;
      // Identity follows the existing Audius client profile model; do not claim a
      // host role while another user already has the host connection.
      const occupied = this.peers().some(peer => peer !== ws && peer.deserializeAttachment().user?.isHost && peer.deserializeAttachment().user.userId !== u.userId);
      session.user = {
        userId: u.userId, handle: String(u.handle || '').slice(0, 160),
        name: String(u.name || 'Guest').slice(0, 160), avatar: typeof u.avatar === 'string' ? u.avatar.slice(0, 2048) : null,
        isHost: Boolean(u.isHost) && !occupied,
      };
      ws.serializeAttachment(session);
      this.updatePresence();
    } else if (message.type === 'untrack') {
      session.user = null;
      ws.serializeAttachment(session);
      this.updatePresence();
    } else if (message.type === 'broadcast' && events.has(message.event)) {
      if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return;
      const lobby = session.channel === 'lobby';
      if (lobby !== (message.event === 'room-announce')) return;
      if (!lobby && !session.user) return;
      if (hostEvents.has(message.event) && !session.user?.isHost) return;
      if (message.event === 'chat' && (typeof message.payload?.text !== 'string' || message.payload.text.length > 2000)) return;
      for (const peer of this.peers()) if (peer !== ws) this.send(peer, { type: 'broadcast', event: message.event, payload: message.payload });
      if (lobby && typeof message.payload?.roomId === 'string' && message.payload.roomId.length <= 160 && Date.now() - (session.lastAnnounce || 0) > 30000) {
        session.lastAnnounce = Date.now();
        ws.serializeAttachment(session);
        try {
          await this.env.DB.prepare('UPDATE rooms SET last_active_at = ? WHERE room_id = ?')
            .bind(new Date().toISOString(), message.payload.roomId).run();
        } catch (error) { console.error('Room heartbeat persistence failed:', error.message); }
      }
    }
  }
  webSocketClose(ws, code, reason) {
    // 1005/1006 describe missing/abnormal close frames and cannot be sent on wire.
    ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    this.updatePresence();
  }
  webSocketError(ws) {
    ws.close(1011, 'Connection error');
    this.updatePresence();
  }
}
