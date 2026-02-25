// Netlify serverless function — proxies authenticated Audius write operations.
// The API secret stays server-side and never reaches the browser.
// Auth: HTTP Basic Auth with base64(apiKey:apiSecret)

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
  if ((action === 'favorite' || action === 'unfavorite' || action === 'repost' || action === 'unrepost') && (!trackId || typeof trackId !== 'string')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing trackId' }) };
  }
  if ((action === 'follow' || action === 'unfollow') && (!targetUserId || typeof targetUserId !== 'string')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing targetUserId' }) };
  }

  // Read secrets from environment (never sent to client)
  const apiKey = process.env.AUDIUS_API_KEY;
  const apiSecret = process.env.AUDIUS_API_SECRET;
  if (!apiKey || !apiSecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured — missing Audius credentials' }) };
  }

  // Build the Audius API request
  const apiPath = actionDef.path({ userId, trackId, targetUserId });
  const url = `${AUDIUS_API_BASE}${apiPath}`;
  const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: actionDef.method,
      headers: {
        'x-api-key': apiKey,
        'Authorization': `Basic ${basicAuth}`,
      },
    });

    const responseBody = await res.text();

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `Audius API error: ${res.status}`, detail: responseBody }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: responseBody,
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to reach Audius API', detail: e.message }),
    };
  }
};
