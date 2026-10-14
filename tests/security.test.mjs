import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../js/security.js';
import { authenticate } from '../worker/auth.mjs';

test('quotes and markup cannot break out of quoted HTML attributes', () => {
  const attack = 'https://example.test/" onerror="alert(1)\'><script>&';
  assert.equal(escapeHtml(attack), 'https://example.test/&quot; onerror=&quot;alert(1)&#39;&gt;&lt;script&gt;&amp;');
  assert.equal(escapeHtml(null), '');
});

test('Audius verification fails closed for forged, wrong-app and expired tokens', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const token = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
  const env = { AUDIUS_API_KEY: 'our-app' };
  const request = credential => new Request('https://local/api/data', { headers: { Authorization: `Bearer ${credential}` } });
  let data = { userId: 'owner', apiKey: 'our-app', handle: 'owner' };
  globalThis.fetch = async () => Response.json({ data });
  const valid = token({ exp: Math.floor(Date.now() / 1000) + 600 });
  assert.equal((await authenticate(request(valid), env)).userId, 'owner');
  data = { ...data, apiKey: 'another-app' };
  await assert.rejects(authenticate(request(valid), env), error => error.status === 401);
  data = { ...data, apiKey: 'our-app' };
  await assert.rejects(authenticate(request(token({ exp: 1 })), env), error => error.status === 401);
  globalThis.fetch = async () => new Response('forged', { status: 404 });
  await assert.rejects(authenticate(request(valid), env), error => error.status === 401);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(authenticate(request(valid), env), error => error.status === 503);
});
