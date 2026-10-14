import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('Cloudflare backend: persistence, validation, and two-client room communication', { timeout: 60000 }, async t => {
  mkdirSync('.wrangler/test', { recursive: true });
  await build({ entryPoints: ['worker/index.mjs'], outfile: '.wrangler/test/worker.mjs', bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const upstream = [];
  const token = user => 'header.' + Buffer.from(JSON.stringify({ user, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url') + '.signature';
  const ownerToken = token('owner');
  const guestToken = token('guest');
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: '.wrangler/test/worker.mjs', compatibilityDate: '2026-10-12',
    compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
    durableObjects: { CHANNELS: { className: 'RoomChannel', useSQLite: true } },
    bindings: { AUDIUS_API_KEY: 'test-key', AUDIUS_BEARER_TOKEN: 'test-bearer-token', AUDIUS_API_SECRET: 'legacy-secret' },
    outboundService: async request => {
      if (new URL(request.url).pathname === '/v1/users/verify_token') {
        const incoming = new URL(request.url).searchParams.get('token');
        const user = incoming === ownerToken ? 'owner' : incoming === guestToken ? 'guest' : null;
        return user ? Response.json({ data: { apiKey: 'test-key', userId: user, handle: user === 'owner' ? 'test-room' : 'guest', name: user } }) : new Response('invalid', { status: 404 });
      }
      upstream.push({ url: request.url, method: request.method, key: request.headers.get('x-api-key'), auth: request.headers.get('Authorization') });
      return Response.json({ data: 'ok' });
    },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const file of ['migrations/0001_initial.sql', 'migrations/0002_demo_playlist.sql']) {
    for (const statement of readFileSync(file, 'utf8').split(';').filter(s => s.trim())) await db.prepare(statement).run();
  }
  const call = async (op, args = {}, credential = ownerToken) => {
    const res = await mf.dispatchFetch('http://local/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify({ op, args }) });
    return { status: res.status, ...(await res.json()) };
  };
  await t.test('persists playlists, room state, permanent status and recent chat', async () => {
    assert.equal((await call('loadPermanentRooms')).data.length, 4);
    const seeded = (await call('loadRoom', { roomId: '247room4' })).data;
    assert.ok(seeded.playlist.length > 10);
    const tracks = [{ id: 'track', title: "A 'quoted' track" }];
    assert.equal((await call('savePlaylist', { userId: 'owner', tracks })).data, true);
    assert.deepEqual((await call('loadPlaylist', { userId: 'owner' })).data, tracks);
    const room = { roomId: 'test-room', hostName: 'Host', playlist: tracks, userCount: 2, playbackState: { savedAt: 123, position: 12 } };
    assert.equal((await call('saveRoom', { room })).data, true);
    assert.deepEqual((await call('loadRoom', { roomId: room.roomId })).data.playback_state, room.playbackState);
    assert.equal((await call('loadActiveRooms')).data[0].room_id, room.roomId);
    assert.equal((await call('saveRoom', { room: { ...room, roomId: '247room4' } })).status, 403);
    assert.equal((await call('loadRoom', { roomId: '247room4' })).data.is_permanent, true);
    for (let timestamp = 1; timestamp <= 4; timestamp++) {
      await call('saveChatMessage', { roomId: room.roomId, message: { userId: 'owner', text: `message ${timestamp}`, timestamp } });
    }
    assert.deepEqual((await call('loadChatHistory', { roomId: room.roomId, limit: 2 })).data.map(m => m.text), ['message 3', 'message 4']);
    await call('updateRoomUserCount', { roomId: room.roomId, userCount: 0 });
    assert.equal((await call('loadActiveRooms')).data.length, 0);
    assert.ok((await call('loadInactiveRooms')).data.some(r => r.room_id === room.roomId));
    // A SQL-looking identifier cannot bypass ownership checks.
    assert.equal((await call('savePlaylist', { userId: "'; DROP TABLE rooms; --", tracks })).status, 403);
    assert.equal((await mf.dispatchFetch('http://local/api/health')).status, 200);
  });
  await t.test('rejects invalid operations, oversized chat and cross-origin writes', async () => {
    assert.equal((await call('dropTables')).status, 400);
    assert.equal((await call('saveChatMessage', { roomId: 'test', message: { userId: 'owner', text: 'x'.repeat(2001), timestamp: 1 } })).status, 400);
    const cross = await mf.dispatchFetch('http://local/api/data', { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(cross.status, 403);
    assert.equal((await mf.dispatchFetch('http://local/api/unknown')).status, 404);
    assert.equal((await mf.dispatchFetch('http://local/.netlify/functions/audius-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ action: 'follow', userId: 'owner' }) })).status, 400);
  });
  await t.test('preserves all six Audius action endpoints and authentication', async () => {
    const paths = { favorite: '/tracks/track/favorites', unfavorite: '/tracks/track/favorites', repost: '/tracks/track/reposts', unrepost: '/tracks/track/reposts', follow: '/users/target/following', unfollow: '/users/target/following' };
    for (const action of Object.keys(paths)) {
      const response = await mf.dispatchFetch('http://local/.netlify/functions/audius-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ action, userId: 'owner', trackId: 'track', targetUserId: 'target' }) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { data: 'ok' });
      assert.deepEqual(upstream.at(-1), { url: `https://api.audius.co/v1${paths[action]}?user_id=owner`, method: action.startsWith('un') ? 'DELETE' : 'POST', key: 'test-key', auth: 'Bearer test-bearer-token' });
    }
  });
  await t.test('authentication and ownership reject forged writes', async () => {
    const tracks = [];
    assert.equal((await call('savePlaylist', { userId: 'owner', tracks }, null)).status, 401);
    assert.equal((await call('savePlaylist', { userId: 'owner', tracks }, 'forged')).status, 401);
    assert.equal((await call('savePlaylist', { userId: 'owner', tracks }, guestToken)).status, 403);
    assert.equal((await call('loadPlaylist', { userId: 'owner' }, guestToken)).status, 403);
    assert.equal((await call('saveRoom', { room: { roomId: 'test-room', playlist: [] } }, guestToken)).status, 403);
    assert.equal((await call('updateRoomCurrentTrack', { roomId: 'test-room', currentTrack: {} }, guestToken)).status, 403);
    assert.equal((await call('saveChatMessage', { roomId: 'test-room', message: { userId: 'owner', text: 'forged', timestamp: 1 } }, guestToken)).status, 403);
  });
  await t.test('presence, playback, chat, isolation, heartbeat, and reconnect', async () => {
    await db.prepare("INSERT INTO rooms(room_id,host_user_id) VALUES ('integration','owner')").run();
    async function connect(channel, credential = null) {
      const response = await mf.dispatchFetch(`http://local/api/realtime?channel=${encodeURIComponent(channel)}`, { headers: { Upgrade: 'websocket', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) } });
      assert.equal(response.status, 101);
      const socket = response.webSocket;
      const messages = [];
      socket.addEventListener('message', ({ data }) => { messages.push(data === 'pong' ? data : JSON.parse(data)); });
      socket.accept();
      return { socket, messages, send: value => socket.send(JSON.stringify(value)) };
    }
    async function until(predicate) {
      const end = Date.now() + 3000;
      while (!predicate()) {
        if (Date.now() > end) throw new Error('Expected room event did not arrive');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const host = await connect('room:integration', ownerToken);
    const guest = await connect('room:integration');
    const other = await connect('room:isolated');
    const impostor = await connect('room:integration', guestToken);
    host.send({ type: 'track', user: { userId: 'host', isHost: true } });
    guest.send({ type: 'track', user: { userId: 'guest', isHost: false } });
    await until(() => host.messages.some(m => m.type === 'presence' && Object.keys(m.state).length === 2));
    guest.send({ type: 'track', user: { userId: 'owner', isHost: true } });
    impostor.send({ type: 'track', user: { userId: 'owner', isHost: true } });
    impostor.send({ type: 'broadcast', event: 'ban', payload: { userId: 'owner' } });
    impostor.send({ type: 'broadcast', event: 'sync', payload: { currentTime: 999 } });
    guest.send({ type: 'broadcast', event: 'ban', payload: { userId: 'owner' } });
    guest.send({ type: 'broadcast', event: 'sync', payload: { currentTime: 999 } });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(!host.messages.some(m => m.event === 'ban' || m.payload?.currentTime === 999));
    impostor.socket.close();
    host.send({ type: 'broadcast', event: 'sync', payload: { currentTime: 42, isPlaying: true } });
    await until(() => guest.messages.some(m => m.event === 'sync' && m.payload.currentTime === 42));
    assert.ok(!other.messages.some(m => m.event === 'sync'));
    guest.send({ type: 'broadcast', event: 'chat', payload: { text: 'Hello' } });
    await until(() => host.messages.some(m => m.event === 'chat'));
    guest.socket.send('ping');
    await until(() => guest.messages.includes('pong'));
    guest.socket.close();
    await until(() => host.messages.some(m => m.type === 'presence' && Object.keys(m.state).length === 1 && m.state.owner));
    const rejoined = await connect('room:integration');
    rejoined.send({ type: 'track', user: { userId: 'guest', isHost: false } });
    rejoined.send({ type: 'broadcast', event: 'request-state', payload: { userId: 'guest' } });
    await until(() => host.messages.some(m => m.event === 'request-state'));
    for (const client of [host, rejoined, other]) client.socket.close();
  });
  await t.test('browser channel adapter reconnects and restores presence automatically', async () => {
    await db.prepare("INSERT INTO rooms(room_id,host_user_id) VALUES ('adapter','owner')").run();
    const url = await mf.ready;
    let browserToken = ownerToken;
    globalThis.localStorage = { getItem: () => browserToken };
    globalThis.window = { location: { origin: url.origin }, addEventListener() {}, dispatchEvent() {} };
    const { getRealtimeClient } = await import('../js/realtime.js');
    const host = getRealtimeClient().channel('room:adapter');
    const guest = getRealtimeClient().channel('room:adapter');
    let joins = 0;
    let received = null;
    guest.on('broadcast', { event: 'sync' }, ({ payload }) => { received = payload; });
    try {
      await host.subscribe(() => host.track({ userId: 'host', isHost: true }));
      browserToken = guestToken;
      await guest.subscribe(() => { joins++; guest.track({ userId: 'guest', isHost: false }); });
      const wait = async predicate => {
        const end = Date.now() + 5000;
        while (!predicate()) {
          if (Date.now() > end) throw new Error(`Adapter failed to recover: joins=${joins} socket=${guest.socket.readyState} host=${JSON.stringify(host.presenceState())} guest=${JSON.stringify(guest.presenceState())}`);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      await wait(() => Object.keys(host.presenceState()).length === 2);
      guest.socket.close(1000);
      await wait(() => joins === 2 && Object.keys(host.presenceState()).length === 2);
      browserToken = ownerToken; // The two clients represent separate browser sessions.
      host.send({ event: 'sync', payload: { currentTime: 77 } });
      await wait(() => received?.currentTime === 77);
    } finally {
      host.unsubscribe(); guest.unsubscribe(); delete globalThis.window; delete globalThis.localStorage;
    }
  });
});
