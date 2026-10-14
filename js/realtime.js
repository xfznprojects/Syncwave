import { getSupabaseClient, getSession } from './supabase-client.js';

class Channel {
  constructor(name) { this.name = name; this.handlers = []; this.presence = {}; }
  on(type, filter, callback) { this.handlers.push({ type, event: filter.event, callback }); return this; }
  presenceState() { return this.presence; }
  async subscribe(callback) {
    this.callback = callback;
    this.closed = false;
    const session = await getSession();
    const client = getSupabaseClient();
    await client.realtime.setAuth(session.token);
    this.channel = client.channel(this.name, { config: { private: true } });
    for (const event of ['presence', 'sync', 'chat', 'track-change', 'song-request', 'request-response', 'kick', 'ban', 'request-state']) {
      this.channel.on('broadcast', { event }, ({ payload }) => {
        if (event === 'presence') this.presence = payload.data;
        else if (payload.sender === this.sessionId) return;
        for (const h of this.handlers) {
          if (event === 'presence' && h.type === 'presence') h.callback();
          else if (h.type === 'broadcast' && h.event === event) h.callback({ payload: payload.data });
        }
      });
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Room connection timed out')), 10000);
      this.channel.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          try {
            await callback?.(status);
            clearInterval(this.heartbeat);
            this.heartbeat = setInterval(() => { if (this.user) void this.track(this.user).catch(console.warn); }, 25000);
            resolve(this);
          } catch (error) { reject(error); }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout); reject(new Error('Room authorization failed'));
        }
      });
    });
  }
  async relay(event, payload) {
    if (this.closed) return false;
    const session = await getSession();
    this.sessionId = session.id;
    const response = await fetch('/.netlify/functions/realtime', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ roomId: this.name.slice(5), event, payload }) });
    if (!response.ok) throw new Error((await response.json()).error || 'Room command rejected');
    return true;
  }
  send(message) { void this.relay(message.event, message.payload).catch(console.warn); }
  async track(user) { this.user = user; return this.relay('track', {}); }
  async untrack() { this.user = null; return this.relay('untrack', {}); }
  async unsubscribe() {
    this.closed = true; clearInterval(this.heartbeat);
    if (this.channel) await getSupabaseClient().removeChannel(this.channel);
  }
}
const client = { channel: name => new Channel(name) };
export function getRealtimeClient() { return client; }
