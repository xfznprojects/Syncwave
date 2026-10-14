import { executeData } from './data.mjs';
export { RoomChannel } from './realtime.mjs';

const AUDIUS_API_BASE = 'https://api.audius.co/v1';
const enc = encodeURIComponent;
const ACTIONS = {
  favorite: { method: 'POST', path: p => `/tracks/${p.trackId}/favorites?user_id=${enc(p.userId)}` },
  unfavorite: { method: 'DELETE', path: p => `/tracks/${p.trackId}/favorites?user_id=${enc(p.userId)}` },
  repost: { method: 'POST', path: p => `/tracks/${p.trackId}/reposts?user_id=${enc(p.userId)}` },
  unrepost: { method: 'DELETE', path: p => `/tracks/${p.trackId}/reposts?user_id=${enc(p.userId)}` },
  follow: { method: 'POST', path: p => `/users/${p.targetUserId}/following?user_id=${enc(p.userId)}` },
  unfollow: { method: 'DELETE', path: p => `/users/${p.targetUserId}/following?user_id=${enc(p.userId)}` },
};
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function readJson(request, maxBytes = 262144) {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Request too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Same Audius endpoints, authentication and response behavior as the Netlify function.
async function audiusAction(request, env) {
  const body = await readJson(request, 8192);
  const { action, userId, trackId, targetUserId } = body;
  const def = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!def) return reply({ error: `Unknown action: ${action}` }, 400);
  if (!userId || typeof userId !== 'string') return reply({ error: 'Missing userId' }, 400);
  if (['favorite', 'unfavorite', 'repost', 'unrepost'].includes(action) && (!trackId || typeof trackId !== 'string')) return reply({ error: 'Missing trackId' }, 400);
  if (['follow', 'unfollow'].includes(action) && (!targetUserId || typeof targetUserId !== 'string')) return reply({ error: 'Missing targetUserId' }, 400);
  if (!env.AUDIUS_API_KEY || (!env.AUDIUS_BEARER_TOKEN && !env.AUDIUS_API_SECRET)) return reply({ error: 'Server misconfigured — missing Audius credentials' }, 500);
  try {
    const res = await fetch(`${AUDIUS_API_BASE}${def.path(body)}`, {
      method: def.method,
      headers: { 'x-api-key': env.AUDIUS_API_KEY, Authorization: env.AUDIUS_BEARER_TOKEN ? `Bearer ${env.AUDIUS_BEARER_TOKEN}` : `Basic ${btoa(`${env.AUDIUS_API_KEY}:${env.AUDIUS_API_SECRET}`)}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return reply({ error: `Audius API error: ${res.status}`, detail: (await res.text()).slice(0, 8192) }, res.status);
    return new Response(res.body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return reply({ error: 'Failed to reach Audius API' }, 502); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const api = url.pathname.startsWith('/api/') || url.pathname === '/.netlify/functions/audius-action';
    if (!api) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return reply({ error: 'Origin not allowed' }, 403);
    if (env.API_LIMIT) {
      const { success } = await env.API_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
      if (!success) return reply({ error: 'Too many requests. Please try again shortly.' }, 429);
    }
    if (url.pathname === '/api/realtime') {
      if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
      const channel = url.searchParams.get('channel');
      if (!channel || channel.length > 165 || !(channel === 'lobby' || (channel.startsWith('room:') && channel.length > 5))) return reply({ error: 'Invalid channel' }, 400);
      return env.CHANNELS.getByName(channel).fetch(request);
    }
    if (url.pathname === '/api/health') {
      try {
        await env.DB.prepare('SELECT room_id FROM rooms LIMIT 1').first();
        return reply({ ok: true });
      } catch { return reply({ ok: false, error: 'Database unavailable or migrations missing' }, 503); }
    }
    if (!['/api/data', '/api/audius-action', '/.netlify/functions/audius-action'].includes(url.pathname)) return reply({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    if (!request.headers.get('Content-Type')?.includes('application/json')) return reply({ error: 'JSON required' }, 415);
    try {
      if (url.pathname !== '/api/data') return await audiusAction(request, env);
      let body;
      try { body = await readJson(request); } catch { return reply({ error: 'Invalid JSON or request too large' }, 400); }
      if (!body || typeof body.op !== 'string' || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) return reply({ error: 'Invalid operation' }, 400);
      return reply({ data: await executeData(env.DB, body.op, body.args) });
    } catch (error) {
      const invalid = /^(Invalid|Unknown|Missing)/.test(error.message);
      if (!invalid) console.error(JSON.stringify({ event: 'backend-error', path: url.pathname, message: error.message }));
      return reply({ error: invalid ? error.message : 'The room service is temporarily unavailable. Please try again.' }, invalid ? 400 : 503);
    }
  },
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM chat_messages WHERE created_at < ?').bind(new Date(Date.now() - 7 * 86400000).toISOString()).run();
  },
};
