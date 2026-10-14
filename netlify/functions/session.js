const { sign, reply, validateRequest } = require('../session.cjs');
exports.handler = async event => {
  try {
    validateRequest(event);
    const { authenticate } = await import('../auth.mjs');
    const user = await authenticate(new Request('https://local/session', { headers: event.headers }), process.env);
    return reply(200, sign(user));
  } catch (error) { return reply(error.status || 503, { error: error.status ? error.message : 'Session service unavailable' }); }
};
