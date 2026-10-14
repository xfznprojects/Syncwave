const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function secret() {
  const key = process.env.SUPABASE_JWT_SECRET;
  if (!key) throw Object.assign(new Error('Supabase session signing is not configured'), { status: 503 });
  return key;
}
function sign(user) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { role: 'authenticated', aud: 'authenticated', iss: 'syncwave', sub: randomUUID(), jti: randomUUID(),
    iat: now, exp: Math.min(now + 900, user ? Math.floor(user.expires / 1000) : now + 900),
    audius_user_id: user?.userId || null, audius_handle: user?.handle || null,
    audius_name: user?.name || 'Guest', audius_avatar: user?.avatar || null, audius_verified: user?.verified || false };
  const message = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return { token: `${message}.${createHmac('sha256', secret()).update(message).digest('base64url')}`, expires: claims.exp * 1000 };
}
function verify(header) {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || token.length > 8192) throw Object.assign(new Error('Session required'), { status: 401 });
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid session'), { status: 401 });
  const expected = createHmac('sha256', secret()).update(`${parts[0]}.${parts[1]}`).digest();
  const signature = Buffer.from(parts[2], 'base64url');
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw Object.assign(new Error('Invalid session'), { status: 401 });
  let claims, headerClaims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url')); headerClaims = JSON.parse(Buffer.from(parts[0], 'base64url')); }
  catch { throw Object.assign(new Error('Invalid session'), { status: 401 }); }
  if (headerClaims.alg !== 'HS256' || claims.iss !== 'syncwave' || claims.role !== 'authenticated' ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 || !claims.jti || !claims.sub) {
    throw Object.assign(new Error('Session expired or invalid'), { status: 401 });
  }
  return claims;
}
function reply(statusCode, data) { return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) }; }
function validateRequest(event) {
  if (event.httpMethod !== 'POST') throw Object.assign(new Error('POST required'), { status: 405 });
  const origin = event.headers?.origin;
  const host = event.headers?.host;
  if (origin && (!host || new URL(origin).host !== host)) throw Object.assign(new Error('Origin not allowed'), { status: 403 });
}
module.exports = { sign, verify, reply, validateRequest };
