import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDelta, formatSplitTime, formatTimer } from '../src/view/time.js';

test('formats the run timer with hundredths', () => {
  assert.equal(formatTimer(0), '0:00.00');
  assert.equal(formatTimer(1234), '0:01.23');
  assert.equal(formatTimer(61_000), '1:01.00');
  assert.equal(formatTimer(3_723_450), '1:02:03.45');
});

test('keeps the sign of a start offset countdown', () => {
  assert.equal(formatTimer(-3000), '-0:03.00');
});

test('split times keep hours instead of overflowing minutes', () => {
  assert.equal(formatSplitTime(null), '--');
  assert.equal(formatSplitTime(12_300), '12.3');
  assert.equal(formatSplitTime(65_000), '1:05');
  assert.equal(formatSplitTime(3_930_000), '1:05:30');
});

test('deltas stay inside the front slot', () => {
  assert.equal(formatDelta(-1200), '-1.2');
  assert.equal(formatDelta(3400), '+3.4');
  assert.equal(formatDelta(65_000), '+1:05');
  assert.equal(formatDelta(3_930_000), '+1:05');
  assert.ok(formatDelta(3_930_000).length <= 5);
});
