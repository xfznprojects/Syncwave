import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleGifs } from '../worker/gifs.mjs';

test('GIF proxy keeps provider credentials server-side and preserves search terms', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(new URL(url));
    return Response.json({ results: [{ id: 'gif-1', media_formats: { gif: { url: 'https://media.klipy.com/example.gif' } } }] });
  };
  try {
    const request = new Request('https://syncwave.pages.dev/api/gifs?action=search&q=hello%20%26%20goodbye!');
    const response = await handleGifs(request, { KLIPY_API_KEY: 'private-gif-key' });
    assert.equal(response.status, 200);
    assert.equal(calls[0].origin, 'https://api.klipy.com');
    assert.equal(calls[0].pathname, '/v2/search');
    assert.equal(calls[0].searchParams.get('q'), 'hello & goodbye!');
    assert.equal(calls[0].searchParams.get('key'), 'private-gif-key');
    assert.ok(!(await response.text()).includes('private-gif-key'));
    await handleGifs(new Request('https://site/api/gifs?action=featured'), { KLIPY_API_KEY: 'key' });
    await handleGifs(new Request('https://site/api/gifs?action=trending_terms'), { KLIPY_API_KEY: 'key' });
    await handleGifs(new Request('https://site/api/gifs?action=registershare&id=gif-1'), { KLIPY_API_KEY: 'key' });
    assert.deepEqual(calls.map(u => u.pathname), ['/v2/search','/v2/featured','/v2/trending_terms','/v2/registershare']);
  } finally { globalThis.fetch = original; }
});

test('GIF proxy validates requests and distinguishes missing setup from empty results', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Requests with invalid input must not reach the provider'); };
  try {
    assert.equal((await handleGifs(new Request('https://site/api/gifs'), {})).status, 503);
    assert.equal((await handleGifs(new Request('https://site/api/gifs?action=https://other.example'), { KLIPY_API_KEY: 'key' })).status, 400);
    assert.equal((await handleGifs(new Request('https://site/api/gifs?action=search&q='), { KLIPY_API_KEY: 'key' })).status, 400);
    assert.equal((await handleGifs(new Request('https://site/api/gifs?action=registershare&id=../../secret'), { KLIPY_API_KEY: 'key' })).status, 400);
    globalThis.fetch = async () => new Response('provider-specific private error', { status: 401 });
    const failure = await handleGifs(new Request('https://site/api/gifs'), { KLIPY_API_KEY: 'key' });
    assert.equal(failure.status, 502);
    assert.ok(!(await failure.text()).includes('private error'));
  } finally { globalThis.fetch = original; }
});

test('Pages gateway forwards original requests, including WebSocket upgrade headers', async () => {
  const { default: gateway } = await import('../pages/public/_worker.js');
  for (const request of [new Request('https://syncwave.pages.dev/'), new Request('https://syncwave.pages.dev/api/realtime?channel=lobby', { headers: { Upgrade: 'websocket', Origin: 'https://syncwave.pages.dev' } })]) {
    let received;
    const expected = new Response('ok');
    const actual = gateway.fetch(request, { SYNCWAVE: { fetch: incoming => { received = incoming; return expected; } } });
    assert.equal(received, request);
    assert.equal(actual, expected);
  }
});
