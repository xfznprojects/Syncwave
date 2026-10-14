import { authHeaders } from './security.js';
export async function dataRequest(op, args = {}) {
  const response = await fetch('/api/data', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ op, args }), signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || 'The room service is unavailable');
    error.status = response.status;
    throw error;
  }
  return body.data;
}
export function backendStatus(kind, available, failure = {}) {
  window.dispatchEvent(new CustomEvent('backend-status', { detail: { kind, available, ...failure } }));
}

export function backendFailureMessage(detail) {
  if (detail.status === 401 || detail.reason === 'Login expired') return 'Your Audius login is no longer valid. Log out and log in again to restore live features. Music playback can continue.';
  if (detail.status === 403) return 'A room action was denied: ' + (detail.message || 'You do not have permission for this action.');
  if (detail.status === 429 || detail.reason === 'Too many messages') return 'Room request limit reached. Please wait briefly before retrying; music playback can continue.';
  if (detail.kind === 'database') return 'Room data could not be loaded or saved. Please retry; music playback can continue.';
  return 'Live room connection interrupted. Reconnecting automatically; music playback can continue.';
}

const unavailable = new Map();
window.addEventListener('backend-status', ({ detail }) => {
  if (detail.available) unavailable.delete(detail.kind);
  else unavailable.set(detail.kind, detail);
  let banner = document.getElementById('connection-status');
  if (!banner && unavailable.size) {
    banner = document.createElement('div');
    banner.id = 'connection-status';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:10000;padding:12px 16px;background:#251c25;color:#fff;border:1px solid #c97db6;border-radius:8px;font:14px sans-serif';
    const message = document.createElement('span');
    message.id = 'connection-status-message';
    banner.appendChild(message);
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.style.cssText = 'margin-left:8px;padding:4px 10px;cursor:pointer';
    retry.onclick = () => window.dispatchEvent(new Event('backend-retry'));
    banner.appendChild(retry);
    document.body.appendChild(banner);
  }
  if (banner) {
    banner.hidden = unavailable.size === 0;
    const failures = [...unavailable.values()];
    const failure = failures.find(f => f.status === 401 || f.reason === 'Login expired') || failures[failures.length - 1];
    if (failure) document.getElementById('connection-status-message').textContent = backendFailureMessage(failure) + ' ';
  }
});
