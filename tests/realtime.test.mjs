import { test } from 'node:test';
import assert from 'node:assert/strict';
import session from '../netlify/session.cjs';
import realtime from '../netlify/functions/realtime.js';

test('Netlify relay rejects forged host commands and stamps chat and presence identity', async t => {
  const previous = globalThis.fetch;
  const oldEnv = { ...process.env };
  t.after(() => { globalThis.fetch = previous; process.env = oldEnv; });
  Object.assign(process.env, { SUPABASE_JWT_SECRET: 'test-only-signing-key', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'server-only' });
  const sign = id => session.sign({ userId: id, handle: id, name: id, expires: Date.now() + 3600000 }).token;
  const owner = sign('owner');
  const attacker = sign('attacker');
  const broadcasts = [];
  const writes = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer server-only');
    if (url.includes('/realtime/v1/api/broadcast')) { broadcasts.push(JSON.parse(options.body)); return new Response(''); }
    if (url.includes('/rest/v1/rooms') && !options.method) return Response.json([{ host_user_id: 'owner', banned_users: [] }]);
    if (options.method) { writes.push({ url, body: options.body && JSON.parse(options.body) }); return new Response(''); }
    return Response.json([]);
  };
  const call = (token, event, payload = {}) => realtime.handler({ httpMethod: 'POST',
    headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ roomId: 'owner', event, payload }) });
  for (const event of ['sync', 'track-change', 'kick', 'ban', 'request-response']) {
    assert.equal((await call(attacker, event)).statusCode, 403);
    assert.equal((await call(session.sign(null).token, event)).statusCode, 403);
  }
  assert.equal(broadcasts.length, 0);
  assert.equal((await call(owner, 'sync', { currentTime: 42 })).statusCode, 200);
  assert.equal(broadcasts[0].messages[0].private, true);
  assert.equal((await call(attacker, 'chat', { userId: 'owner', name: 'Owner', text: 'Hello' })).statusCode, 200);
  assert.equal(broadcasts.at(-1).messages[0].payload.data.userId, 'attacker');
  assert.equal(broadcasts.at(-1).messages[0].payload.data.name, 'attacker');
  assert.equal((await call(attacker, 'track', { userId: 'owner', isHost: true })).statusCode, 200);
  assert.equal(writes[0].body.profile.userId, 'attacker');
  assert.equal(writes[0].body.profile.isHost, false);
  const parts = owner.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...session.verify(`Bearer ${owner}`), audius_user_id: 'attacker' })).toString('base64url');
  assert.equal((await call(parts.join('.'), 'sync')).statusCode, 401);
  const guest = session.verify(`Bearer ${session.sign(null).token}`);
  assert.equal(guest.audius_user_id, null);
});
