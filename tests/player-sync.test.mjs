import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
const { resolveSyncTargetPosition } = await import('../js/player.js');

test('live sync uses the host audio position even when device clocks disagree', () => {
  const now = 1_800_000_000_000;
  assert.equal(resolveSyncTargetPosition({ currentTime: 42.5, startedAt: now - 2_000 }, now + 60_000), 42.5);
});

test('legacy sync events can still derive a nonnegative position from startedAt', () => {
  assert.equal(resolveSyncTargetPosition({ startedAt: 1_800_000_000_000 }, 1_800_000_003_250), 3.25);
  assert.equal(resolveSyncTargetPosition({ startedAt: 1_800_000_000_000 }, 1_799_999_999_000), 0);
  assert.equal(resolveSyncTargetPosition({}), null);
});
