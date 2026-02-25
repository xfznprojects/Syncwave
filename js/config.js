// SyncWave Configuration
// Keys are injected via Netlify environment variables at deploy time.
// For local development, replace the empty strings below (but NEVER commit real keys).

const CONFIG = {
  AUDIUS_API_KEY: '',
  AUDIUS_API_BASE: 'https://api.audius.co/v1',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  TENOR_API_KEY: '',
  SYNC_INTERVAL_MS: 3000,
  DRIFT_THRESHOLD_MS: 500,
};

export default CONFIG;
