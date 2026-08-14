import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDelta,
  formatSplitTime,
  formatTimer,
  MAX_DELTA_CHARS,
} from '../src/view/time.js';

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
  assert.equal(formatSplitTime(12_300), '0:12');
  assert.equal(formatSplitTime(48_900), '0:48');
  assert.equal(formatSplitTime(65_000), '1:05');
  assert.equal(formatSplitTime(3_930_000), '1:05:30');
});

test('deltas stay inside the front slot', () => {
  assert.equal(formatDelta(-1200), '-1.2');
  assert.equal(formatDelta(3400), '+3.4');
  assert.equal(formatDelta(14_400), '+14.4');
  assert.equal(formatDelta(65_000), '+1:05');
  assert.equal(formatDelta(3_930_000), '+1:05');
});

test('a delta too wide for the slot loses precision, not digits', () => {
  assert.equal(formatDelta(2_730_000), '+45m');
  assert.equal(formatDelta(-2_730_000), '-45m');
  assert.equal(formatDelta(40_000_000), '+11h');
});

test('no delta is ever wider than the slot', () => {
  const worst = [
    59_900, -59_900, 65_000, 599_000, 3_540_000, 35_940_000, 359_999_000,
  ].map(formatDelta);
  for (const text of worst) {
    assert.ok(text.length <= MAX_DELTA_CHARS, `${text} is ${text.length} chars`);
  }
});
