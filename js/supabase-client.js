import CONFIG from './config.js';

let supabase = null;
let cached = null;
let pending = null;

export async function getSession() {
  const credential = localStorage.getItem('syncwave_token');
  if (cached?.credential === credential && cached.expires > Date.now() + 60000) return cached;
  if (pending?.credential === credential) return pending.promise;
  const promise = (async () => {
    const response = await fetch('/.netlify/functions/session', { method: 'POST',
      headers: credential ? { Authorization: `Bearer ${credential}` } : {} });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Login verification failed');
    const decoded = atob(body.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, char => char.charCodeAt(0))));
    return cached = { ...body, credential, id: claims.jti, user: { userId: claims.audius_user_id, handle: claims.audius_handle, name: claims.audius_name, avatar: claims.audius_avatar } };
  })();
  pending = { credential, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}

export function getSupabaseClient() {
  if (!supabase) {
    supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      accessToken: async () => (await getSession()).token,
    });
  }
  return supabase;
}
