import CONFIG from './config.js';

let supabase = null;

export function getSupabaseClient() {
  if (!supabase) {
    supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return supabase;
}
