async function request(action, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`/api/gifs?${query}`, { signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'GIF search is temporarily unavailable.');
  return data.results || [];
}

function normalize(results) {
  return results.map(r => ({
    id: r.id,
    url: r.media_formats?.gif?.url || '',
    preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '',
    description: r.content_description || '',
    dims: r.media_formats?.tinygif?.dims || r.media_formats?.gif?.dims || [200, 200],
  })).filter(r => r.url.startsWith('https://') && r.preview.startsWith('https://'));
}

export async function searchGifs(query) {
  if (!query.trim()) return [];
  return normalize(await request('search', { q: query }));
}
export async function getTrendingGifs() { return normalize(await request('featured')); }
export async function getTrendingTerms() { return request('trending_terms'); }
export function registerGifShare(id, query) {
  // Analytics must never prevent a user from sending their selected GIF.
  void request('registershare', { id, q: query || '' }).catch(() => {});
}
