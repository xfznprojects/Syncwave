// Safe for both text nodes and quoted HTML attributes.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function authHeaders() {
  const token = globalThis.localStorage?.getItem('syncwave_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
