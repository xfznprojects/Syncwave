import { test } from 'node:test';
import assert from 'node:assert/strict';

test('browser listens on private channels and routes all sends through the authenticated relay', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; delete globalThis.localStorage; delete globalThis.window; });
  const jwt = 'header.' + Buffer.from(JSON.stringify({ jti: 'session-id', audius_user_id: 'owner' })).toString('base64url') + '.signature';
  const calls = [];
  let handlers = {};
  let removed = false;
  globalThis.localStorage = { getItem: () => 'audius-token' };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/session')) return Response.json({ token: jwt, expires: Date.now() + 900000 });
    return Response.json({ ok: true });
  };
  const sdk = {
    realtime: { setAuth: async token => assert.equal(token, jwt) },
    channel: (name, options) => {
      assert.equal(name, 'room:owner');
      assert.equal(options.config.private, true);
      return {
        on: (type, filter, callback) => { handlers[filter.event] = callback; },
        subscribe: callback => { void callback('SUBSCRIBED'); },
      };
    },
    removeChannel: async () => { removed = true; },
  };
  globalThis.window = { supabase: { createClient: () => sdk } };
  const { getRealtimeClient } = await import('../js/realtime.js');
  const channel = getRealtimeClient().channel('room:owner');
  let received;
  channel.on('broadcast', { event: 'sync' }, ({ payload }) => { received = payload; });
  await channel.subscribe(() => channel.track({ userId: 'owner', isHost: true }));
  assert.equal(calls.at(-1).options.headers.Authorization, `Bearer ${jwt}`);
  assert.equal(JSON.parse(calls.at(-1).options.body).event, 'track');
  handlers.presence({ payload: { sender: 'other', data: { owner: [{ userId: 'owner', isHost: true }] } } });
  assert.equal(channel.presenceState().owner[0].isHost, true);
  handlers.sync({ payload: { sender: 'other', data: { currentTime: 42 } } });
  assert.equal(received.currentTime, 42);
  await channel.relay('sync', { currentTime: 5 });
  assert.equal(JSON.parse(calls.at(-1).options.body).event, 'sync');
  await channel.untrack();
  await channel.unsubscribe();
  assert.equal(removed, true);
});
