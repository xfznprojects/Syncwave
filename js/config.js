// SyncWave Configuration
// __PLACEHOLDER__ values are replaced in dist/ at build time by build.js.
// For local dev, create a .env file (see .env.example) — build.js reads it too.

const CONFIG = {
  AUDIUS_API_KEY: '__AUDIUS_API_KEY__',
  AUDIUS_API_BASE: 'https://api.audius.co/v1',
  SYNC_INTERVAL_MS: 3000,
  DRIFT_THRESHOLD_MS: 1200,
};

export default CONFIG;
