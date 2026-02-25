import CONFIG from './config.js';

const API = CONFIG.AUDIUS_API_BASE;

function headers() {
  return { 'x-api-key': CONFIG.AUDIUS_API_KEY };
}

async function apiFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`Audius API error: ${res.status}`);
  return res.json();
}

export async function searchTracks(query, limit = 25, offset = 0) {
  const data = await apiFetch(`/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
  return data.data || [];
}

export async function getTrending(genre = null, time = 'week', limit = 25, offset = 0) {
  let path = `/tracks/trending?time=${time}&limit=${limit}&offset=${offset}`;
  if (genre) path += `&genre=${encodeURIComponent(genre)}`;
  const data = await apiFetch(path);
  return data.data || [];
}

export async function getTrack(trackId) {
  const data = await apiFetch(`/tracks/${trackId}`);
  return data.data;
}

export function getStreamUrl(trackId) {
  return `${API}/tracks/${trackId}/stream?api_key=${CONFIG.AUDIUS_API_KEY}`;
}

export async function getUser(userId) {
  const data = await apiFetch(`/users/${userId}`);
  return data.data;
}

// Artwork helper: returns the best available artwork URL.
// Use setArtworkWithFallback() on <img> elements for mirror retry.
export function getArtworkUrl(track, size = '480x480') {
  if (!track?.artwork) return null;
  // artwork can be a plain URL string (from DB) or an object with size keys (from API)
  if (typeof track.artwork === 'string') return track.artwork;
  return track.artwork[size] || track.artwork['150x150'] || null;
}

// Stable fallback content nodes (most reliable on the Audius network)
const FALLBACK_NODES = [
  'https://creatornode2.audius.co',
  'https://creatornode3.audius.co',
  'https://audius-content-1.figment.io',
];

// Sets any <img> src with content-node mirror fallback on error.
// Optional onAllFailed callback fires when all mirrors are exhausted.
export function setImageWithFallback(imgEl, url, onAllFailed) {
  if (!url) { imgEl.src = ''; return; }
  let mirrorIndex = 0;
  imgEl.src = url;
  imgEl.onerror = () => {
    try {
      const parsed = new URL(url);
      while (mirrorIndex < FALLBACK_NODES.length) {
        const mirrorBase = FALLBACK_NODES[mirrorIndex++];
        if (url.startsWith(mirrorBase)) continue;
        imgEl.src = mirrorBase + parsed.pathname;
        return;
      }
    } catch { /* invalid URL */ }
    // All mirrors exhausted
    imgEl.onerror = null;
    if (onAllFailed) onAllFailed(imgEl);
  };
}

// Sets an <img> src with mirror fallback on error.
export function setArtworkWithFallback(imgEl, track, size = '480x480') {
  if (!track?.artwork) {
    imgEl.src = '';
    return;
  }
  const primary = typeof track.artwork === 'string'
    ? track.artwork
    : (track.artwork[size] || track.artwork['150x150']);

  // Build fallback list: API-provided mirrors first, then global fallback nodes
  const apiMirrors = (typeof track.artwork === 'object' && track.artwork.mirrors) || [];
  const allMirrors = [...apiMirrors, ...FALLBACK_NODES];
  let mirrorIndex = 0;

  imgEl.src = primary || '';
  imgEl.onerror = () => {
    if (!primary) return;
    try {
      const url = new URL(primary);
      while (mirrorIndex < allMirrors.length) {
        const mirrorBase = allMirrors[mirrorIndex++];
        // Skip if the failing URL is already from this mirror
        if (primary.startsWith(mirrorBase)) continue;
        imgEl.src = mirrorBase + url.pathname;
        return;
      }
    } catch { /* invalid URL, give up */ }
  };
}

export async function getUserTracks(userId, limit = 25, offset = 0) {
  const data = await apiFetch(`/users/${userId}/tracks?limit=${limit}&offset=${offset}`);
  return data.data || [];
}

export async function getUserFavorites(userId, limit = 25, offset = 0) {
  const data = await apiFetch(`/users/${userId}/favorites?limit=${limit}&offset=${offset}`);
  return data.data || [];
}

// Resolve an Audius URL (track, playlist, or user) to its API object
export async function resolveUrl(url) {
  const data = await apiFetch(`/resolve?url=${encodeURIComponent(url)}`);
  // Playlists return data as an array with one element; unwrap it
  const result = data.data;
  return Array.isArray(result) ? result[0] : result;
}

// Get tracks from a playlist by ID
export async function getPlaylistTracks(playlistId) {
  const data = await apiFetch(`/playlists/${playlistId}/tracks`);
  return data.data || [];
}

// Get user avatar URL from profile picture object
export function getUserAvatar(user, size = '150x150') {
  if (!user?.profile_picture) return null;
  return user.profile_picture[size] || user.profile_picture['150x150'] || null;
}

// ─── AUTHENTICATED WRITE OPERATIONS (via Netlify Function proxy) ──────
// The API secret never leaves the server. All write operations are proxied
// through /.netlify/functions/audius-action which holds the secret server-side.

async function proxyAction(action, params) {
  // Import token dynamically to avoid circular dependency
  const { getToken } = await import('./auth.js');
  const token = getToken();
  const reqHeaders = { 'Content-Type': 'application/json' };
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/.netlify/functions/audius-action', {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Action "${action}" failed: ${res.status} ${body}`);
  }
  return res.json();
}

// Track interactions
export async function favoriteTrack(trackId, userId) {
  return proxyAction('favorite', { trackId, userId });
}

export async function unfavoriteTrack(trackId, userId) {
  return proxyAction('unfavorite', { trackId, userId });
}

export async function repostTrack(trackId, userId) {
  return proxyAction('repost', { trackId, userId });
}

export async function unrepostTrack(trackId, userId) {
  return proxyAction('unrepost', { trackId, userId });
}

// User interactions
export async function followUser(targetUserId, userId) {
  return proxyAction('follow', { targetUserId, userId });
}

export async function unfollowUser(targetUserId, userId) {
  return proxyAction('unfollow', { targetUserId, userId });
}
