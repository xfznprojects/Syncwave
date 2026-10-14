import { backendStatus } from './backend.js';
import { authHeaders } from './security.js';

// A small channel adapter keeps room/playback callbacks independent of the transport.
class Channel {
  constructor(name) {
    this.name = name;
    this.handlers = [];
    this.presence = {};
    this.closed = false;
    this.attempt = 0;
    this.user = null;
  }
  on(type, filter, callback) { this.handlers.push({ type, event: filter.event, callback }); return this; }
  presenceState() { return this.presence; }
  subscribe(callback) {
    this.callback = callback;
    this.closed = false;
    return new Promise((resolve, reject) => {
      this.initial = { resolve, reject };
      this.initialTimeout = setTimeout(() => {
        this.initial = null;
        reject(new Error('The room connection timed out. Please try again.'));
        // Lobby connections may recover later; failed room joins are closed by app.js.
      }, 10000);
      this.connect();
    });
  }
  connect() {
    if (this.closed) return;
    const url = new URL('/api/realtime', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('channel', this.name);
    this.connectionToken = authHeaders().Authorization?.slice(7) || null;
    const socket = this.socket = new WebSocket(url, this.connectionToken ? ['syncwave', `audius.${this.connectionToken}`] : ['syncwave']);
    socket.onopen = () => {
      if (this.closed || socket !== this.socket) return;
      this.attempt = 0;
      backendStatus(this.name, true);
      this.lastPong = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong > 60000) { socket.close(1000); return; }
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, 20000);
      if (this.user) this.track(this.user);
      Promise.resolve(this.callback?.('SUBSCRIBED')).catch(console.warn);
      if (this.initial) {
        clearTimeout(this.initialTimeout);
        this.initial.resolve(this);
        this.initial = null;
      }
      // Ask the host for fresh state on both the first connection and reconnects.
      if (this.user && !this.user.isHost) this.send({ event: 'request-state', payload: { userId: this.user.userId } });
    };
    socket.onmessage = ({ data }) => {
      if (socket !== this.socket) return;
      if (data === 'pong') { this.lastPong = Date.now(); return; }
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (message.type === 'presence') this.presence = message.state;
      for (const h of this.handlers) {
        if (h.type === message.type && (h.type === 'presence' || h.event === message.event)) {
          h.callback(message.type === 'presence' ? undefined : { payload: message.payload });
        }
      }
    };
    socket.onerror = () => socket.close(1000);
    socket.onclose = () => {
      if (socket !== this.socket) return;
      clearInterval(this.heartbeat);
      if (this.closed) return;
      this.presence = {};
      for (const h of this.handlers) if (h.type === 'presence') h.callback();
      backendStatus(this.name, false);
      const delay = Math.min(30000, 1000 * 2 ** this.attempt++) + Math.random() * 500;
      this.retry = setTimeout(() => this.connect(), delay);
    };
  }
  send(message) {
    const token = authHeaders().Authorization?.slice(7) || null;
    if (token !== this.connectionToken) {
      clearInterval(this.heartbeat);
      if (this.socket) { this.socket.onclose = null; this.socket.close(1000); }
      this.connect();
      return false;
    }
    // Do not replay stale playback/chat messages after an outage.
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'broadcast', event: message.event, payload: message.payload }));
    return true;
  }
  track(user) {
    this.user = user;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'track', user }));
  }
  untrack() {
    this.user = null;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'untrack' }));
  }
  unsubscribe() {
    this.closed = true;
    clearTimeout(this.retry);
    clearTimeout(this.initialTimeout);
    clearInterval(this.heartbeat);
    if (this.initial) { this.initial.reject(new Error('Connection cancelled')); this.initial = null; }
    this.socket?.close(1000);
    this.user = null;
    backendStatus(this.name, true);
  }
}
const client = { channel: name => new Channel(name) };
export function getRealtimeClient() { return client; }
