export class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

// The existing popup returns an Audius ID token. Only Audius's verification
// response is trusted; decoding a JWT in the browser does not authenticate it.
export async function authenticate(request, env, tokenOverride) {
  const header = request.headers.get('Authorization') || '';
  const token = tokenOverride ?? (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return null;
  if (typeof token !== 'string' || token.length > 8192 || !env.AUDIUS_API_KEY) throw new AccessError('Invalid login', 401);
  let response;
  try {
    response = await fetch(`https://api.audius.co/v1/users/verify_token?token=${encodeURIComponent(token)}`, {
      headers: { 'x-api-key': env.AUDIUS_API_KEY }, signal: AbortSignal.timeout(10000),
    });
  } catch { throw new AccessError('Login verification unavailable', 503); }
  if (!response.ok) throw new AccessError(response.status >= 500 ? 'Login verification unavailable' : 'Invalid login', response.status >= 500 ? 503 : 401);
  let user;
  try { user = (await response.json()).data; } catch { throw new AccessError('Invalid login', 401); }
  if (!user || user.apiKey !== env.AUDIUS_API_KEY || typeof user.userId !== 'string' || !user.userId ||
      typeof user.handle !== 'string' || !user.handle) throw new AccessError('Invalid login', 401);
  let claims;
  try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { throw new AccessError('Invalid login', 401); }
  if (claims.exp !== undefined && (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now())) throw new AccessError('Login expired', 401);
  return {
    userId: user.userId, handle: user.handle, name: String(user.name || user.handle).slice(0, 160),
    avatar: user.profilePicture?.['150x150'] || user.profile_picture?.['150x150'] || null,
    verified: user.verified === true,
    expires: Math.min(Date.now() + 3600000, claims.exp === undefined ? Infinity : claims.exp * 1000),
  };
}

export function requireUser(user) {
  if (!user) throw new AccessError('Log in with Audius first', 401);
  return user;
}
