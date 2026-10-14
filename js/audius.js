import { authHeaders } from './security.js';
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

export async function searchTracks(query, limit = 25, offset = 0, filters = {}) {
  let path = `/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`;
  if (filters.genre) path += `&genre=${encodeURIComponent(filters.genre)}`;
  if (filters.mood) path += `&mood=${encodeURIComponent(filters.mood)}`;
  if (filters.bpmMin) path += `&bpm_min=${filters.bpmMin}`;
  if (filters.bpmMax) path += `&bpm_max=${filters.bpmMax}`;
  const data = await apiFetch(path);
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

// ─── TRACK ACCESS CHECKS ──────────────────────────────────────────────

// Returns true if the track can be streamed by the general public.
// Checks is_stream_gated and access.stream fields from the Audius API.
export function isTrackStreamable(track) {
  if (!track || !track.id) return false;
  // Explicit gate flag
  if (track.is_stream_gated) return false;
  // access.stream is false → user can't play it
  if (track.access && track.access.stream === false) return false;
  // Deleted or unavailable tracks
  if (track.is_delete) return false;
  if (track.is_available === false) return false;
  return true;
}

// Returns a human-readable reason why a track is not streamable.
export function getGateReason(track) {
  if (!track) return 'Track not found';
  if (track.is_delete) return 'Track has been deleted';
  if (track.is_available === false) return 'Track is unavailable';
  const cond = track.stream_conditions;
  if (cond) {
    if (cond.follow_user_id) return 'Followers only';
    if (cond.tip_user_id) return 'Tip required';
    if (cond.usdc_purchase) {
      const price = (cond.usdc_purchase.price / 100).toFixed(2);
      return `Purchase required ($${price})`;
    }
    if (cond.nft_collection) return 'NFT holders only';
  }
  if (track.is_stream_gated) return 'Restricted access';
  if (track.access && track.access.stream === false) return 'Not streamable';
  return 'Unknown restriction';
}

// Splits an array of tracks into {playable, gated}.
// gated entries include {track, reason} for reporting.
export function filterStreamableTracks(tracks) {
  const playable = [];
  const gated = [];
  for (const track of tracks) {
    if (isTrackStreamable(track)) {
      playable.push(track);
    } else {
      gated.push({ track, reason: getGateReason(track) });
    }
  }
  return { playable, gated };
}

// ─── AUTHENTICATED WRITE OPERATIONS (via the Cloudflare Worker) ──────
// The Worker verifies the user's Audius session and uses its server-side
// bearer token to perform these actions on the user's behalf.

export function describeAudiusActionFailure(action, status, error) {
  const detail = typeof error === 'string' ? error : '';
  if (detail === 'Invalid login' || detail === 'Login expired' || detail === 'Log in with Audius first') {
    return 'Your Audius login expired. Log in again and retry.';
  }
  if (detail === 'Login verification unavailable') return 'Audius login verification is temporarily unavailable. Retry shortly.';
  if (detail.startsWith('Server misconfigured')) return 'Audius actions are not configured on the Cloudflare Worker.';
  if (detail === 'Audius API error: 401') return 'Audius rejected the Worker credentials. Check AUDIUS_API_KEY and AUDIUS_BEARER_TOKEN in Worker secrets.';
  if (status === 401) return 'Your Audius login was rejected. Log in again and retry.';
  if (status === 403) return 'Audius denied this action for your account or this track.';
  if (status === 429) return 'Audius is rate limiting actions right now. Retry shortly.';
  if (status >= 500) return 'Audius is temporarily unavailable. Retry shortly.';
  return `Could not ${action} on Audius${status ? ` (HTTP ${status})` : ''}.`;
}

async function proxyAction(action, params) {
  let res;
  try {
    res = await fetch('/api/audius-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new Error('Could not reach the Cloudflare Worker. Check your connection and retry.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(describeAudiusActionFailure(action, res.status, body.error));
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
