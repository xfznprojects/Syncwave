// The provider key stays in Worker secrets. Callers can only select fixed routes.
const endpoints = new Set(['search', 'featured', 'trending_terms', 'registershare']);
export async function handleGifs(request, env) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'featured';
  const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  if (!endpoints.has(action)) return reply({ error: 'Unknown GIF operation' }, 400);
  if (!env.KLIPY_API_KEY) return reply({ error: 'GIF search is not available yet. Please try again later.' }, 503);
  const upstream = new URL(`https://api.klipy.com/v2/${action}`);
  upstream.searchParams.set('key', env.KLIPY_API_KEY);
  upstream.searchParams.set('client_key', 'syncwave');
  upstream.searchParams.set('locale', 'en_US');
  upstream.searchParams.set('country', request.cf?.country || 'US');
  if (action === 'search' || action === 'registershare') {
    const query = url.searchParams.get('q') || '';
    if (query.length > 200 || (action === 'search' && !query.trim())) return reply({ error: 'Enter a search of up to 200 characters.' }, 400);
    if (query) upstream.searchParams.set('q', query);
  }
  if (action === 'registershare') {
    const id = url.searchParams.get('id');
    if (!id || !/^[\w-]{1,160}$/.test(id)) return reply({ error: 'Invalid GIF identifier' }, 400);
    upstream.searchParams.set('id', id);
  } else {
    upstream.searchParams.set('limit', action === 'trending_terms' ? '10' : '30');
    if (action !== 'trending_terms') {
      upstream.searchParams.set('media_filter', 'gif,tinygif');
      upstream.searchParams.set('contentfilter', 'high');
    }
  }
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return reply({ error: 'GIF search is temporarily unavailable. Please try again.' }, response.status === 429 ? 429 : 502);
    if (action === 'registershare') return reply({ ok: true });
    const data = await response.json();
    return reply({ results: Array.isArray(data.results) ? data.results : [] });
  } catch {
    return reply({ error: 'GIF search is temporarily unavailable. Please try again.' }, 502);
  }
}
