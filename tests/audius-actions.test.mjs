import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAudiusActionFailure } from '../js/audius.js';

test('Audius action failures point to the cause instead of blaming an API secret', () => {
  assert.match(describeAudiusActionFailure('favorite', 401, 'Login expired'), /login expired/i);
  assert.match(describeAudiusActionFailure('favorite', 401, 'Audius API error: 401'), /AUDIUS_BEARER_TOKEN/);
  assert.match(describeAudiusActionFailure('follow', 403, 'Audius API error: 403'), /denied this action/i);
  assert.match(describeAudiusActionFailure('repost', 429, 'rate limited'), /rate limiting/i);
  assert.doesNotMatch(describeAudiusActionFailure('favorite', 502, 'unavailable'), /secret/i);
});
