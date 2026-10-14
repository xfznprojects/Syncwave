import { authHeaders } from './security.js';
export async function dataRequest(op, args = {}) {
  const response = await fetch('/api/data', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ op, args }), signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The room service is unavailable');
  return body.data;
}
export function backendStatus(kind, available) {
  window.dispatchEvent(new CustomEvent('backend-status', { detail: { kind, available } }));
}

const unavailable = new Set();
window.addEventListener('backend-status', ({ detail }) => {
  if (detail.available) unavailable.delete(detail.kind);
  else unavailable.add(detail.kind);
  let banner = document.getElementById('connection-status');
  if (!banner && unavailable.size) {
    banner = document.createElement('div');
    banner.id = 'connection-status';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:10000;padding:12px 16px;background:#251c25;color:#fff;border:1px solid #c97db6;border-radius:8px;font:14px sans-serif';
    banner.textContent = 'Room connection interrupted. Live features will reconnect automatically; music playback can continue. ';
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.style.cssText = 'margin-left:8px;padding:4px 10px;cursor:pointer';
    retry.onclick = () => window.dispatchEvent(new Event('backend-retry'));
    banner.appendChild(retry);
    document.body.appendChild(banner);
  }
  if (banner) banner.hidden = unavailable.size === 0;
});
