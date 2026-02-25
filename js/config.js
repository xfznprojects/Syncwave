// SyncWave Configuration
// __PLACEHOLDER__ values are replaced at build time by build.js using Netlify env vars.
// For local dev, create a .env file (see .env.example) — build.js reads it too.

const CONFIG = {
  AUDIUS_API_KEY: '__AUDIUS_API_KEY__',
  AUDIUS_API_BASE: 'https://api.audius.co/v1',
  SUPABASE_URL: '__SUPABASE_URL__',
  SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__',
  TENOR_API_KEY: '__TENOR_API_KEY__',
  ROOM_HOST_HANDLE: '__ROOM_HOST_HANDLE__',
  SYNC_INTERVAL_MS: 3000,
  DRIFT_THRESHOLD_MS: 500,
};

export default CONFIG;
