import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
const { dataRequest, backendFailureMessage } = await import('../js/backend.js');

test('HTTP authentication errors retain their status and do not describe a lost connection', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Invalid login' }, { status: 401 });
  await assert.rejects(dataRequest('loadPermanentRooms', {}), error => {
    assert.equal(error.status, 401);
    assert.equal(error.message, 'Invalid login');
    assert.match(backendFailureMessage({ kind: 'database', status: error.status }), /Log out and log in again/);
    return true;
  });
});

test('permission failures and expired WebSocket sessions have distinct guidance', () => {
  assert.match(backendFailureMessage({ status: 403, message: 'Room belongs to another user' }), /Room belongs to another user/);
  assert.match(backendFailureMessage({ reason: 'Login expired' }), /Log out and log in again/);
  assert.match(backendFailureMessage({ reason: 'Too many messages' }), /request limit/);
  assert.match(backendFailureMessage({ kind: 'room:example' }), /Reconnecting automatically/);
  assert.match(backendFailureMessage({ kind: 'database', status: 503 }), /data could not be loaded or saved/);
});
