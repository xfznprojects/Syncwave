// Netlify serverless function — proxies authenticated Audius write operations.
// The API secret stays server-side and never reaches the browser.

const AUDIUS_API_BASE = 'https://api.audius.co/v1';

// Allowed actions → { method, pathBuilder }
const ACTIONS = {
  'favorite':    { method: 'POST',   path: (p) => `/tracks/${p.trackId}/favorites?user_id=${enc(p.userId)}` },
  'unfavorite':  { method: 'DELETE', path: (p) => `/tracks/${p.trackId}/favorites?user_id=${enc(p.userId)}` },
  'repost':      { method: 'POST',   path: (p) => `/tracks/${p.trackId}/reposts?user_id=${enc(p.userId)}` },
  'unrepost':    { method: 'DELETE', path: (p) => `/tracks/${p.trackId}/reposts?user_id=${enc(p.userId)}` },
  'follow':      { method: 'POST',   path: (p) => `/users/${p.targetUserId}/following?user_id=${enc(p.userId)}` },
  'unfollow':    { method: 'DELETE', path: (p) => `/users/${p.targetUserId}/following?user_id=${enc(p.userId)}` },
};

function enc(v) { return encodeURIComponent(v); }

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action, userId, trackId, targetUserId } = body;

  // Validate action
  const actionDef = ACTIONS[action];
  if (!actionDef) {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
  }

  // Validate required params
  if (!userId || typeof userId !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) };
  }
  if ((action.includes('favorite') || action.includes('repost') || action === 'favorite' || action === 'unfavorite' || action === 'repost' || action === 'unrepost') && (!trackId || typeof trackId !== 'string')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing trackId' }) };
  }
  if ((action === 'follow' || action === 'unfollow') && (!targetUserId || typeof targetUserId !== 'string')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing targetUserId' }) };
  }

  // Read secrets from environment (never sent to client)
  const apiKey = process.env.AUDIUS_API_KEY;
  const apiSecret = process.env.AUDIUS_API_SECRET;
  const bearerToken = process.env.AUDIUS_BEARER_TOKEN;
  if (!apiKey || (!apiSecret && !bearerToken)) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured — missing Audius credentials' }) };
  }

  // Build the Audius API request
  const apiPath = actionDef.path({ userId, trackId, targetUserId });
  const url = `${AUDIUS_API_BASE}${apiPath}`;

  // Try all auth methods: Basic Auth first, then Bearer, then x-api-secret header
  const authMethods = [];
  if (apiSecret) {
    authMethods.push({
      name: 'basic',
      headers: {
        'x-api-key': apiKey,
        'Authorization': `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      },
    });
  }
  if (bearerToken) {
    authMethods.push({
      name: 'bearer',
      headers: {
        'x-api-key': apiKey,
        'Authorization': `Bearer ${bearerToken}`,
      },
    });
  }
  if (apiSecret) {
    authMethods.push({
      name: 'x-header',
      headers: {
        'x-api-key': apiKey,
        'x-api-secret': apiSecret,
      },
    });
  }

  let lastError = null;
  let triedMethods = [];

  try {
    for (const method of authMethods) {
      const res = await fetch(url, {
        method: actionDef.method,
        headers: method.headers,
      });

      const responseBody = await res.text();

      if (res.ok) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: responseBody,
        };
      }

      triedMethods.push(method.name);
      lastError = { status: res.status, body: responseBody };

      // Only retry on 401/403 (auth failure) — other errors are not auth-related
      if (res.status !== 401 && res.status !== 403) {
        return {
          statusCode: res.status,
          body: JSON.stringify({ error: `Audius API error: ${res.status}`, detail: responseBody }),
        };
      }
    }

    // All auth methods failed
    return {
      statusCode: lastError?.status || 403,
      body: JSON.stringify({
        error: `Audius API error: all auth methods failed`,
        detail: lastError?.body,
        debug: { triedMethods, hasApiKey: !!apiKey, hasSecret: !!apiSecret, hasBearer: !!bearerToken, url },
      }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to reach Audius API', detail: e.message }),
    };
  }
};
