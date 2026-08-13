import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGoldSegment, MIN_GOLD_SEGMENT_MS } from '../src/domain/gold.js';
import { makeSnapshot } from './helpers.js';

test('gold needs a known best segment and a shorter one', () => {
  const snapshot = makeSnapshot({ bestSegmentMs: 5000 });
  assert.equal(isGoldSegment(snapshot, 4000), true);
  assert.equal(isGoldSegment(snapshot, 6000), false);
});

test('an unknown best segment never counts as gold', () => {
  assert.equal(isGoldSegment(makeSnapshot({ bestSegmentMs: null }), 1000), false);
});

test('an unknown segment length never counts as gold', () => {
  assert.equal(isGoldSegment(makeSnapshot({ bestSegmentMs: 5000 }), null), false);
});

test('a segment too short to be real is not gold', () => {
  const snapshot = makeSnapshot({ bestSegmentMs: 5000 });
  assert.equal(isGoldSegment(snapshot, MIN_GOLD_SEGMENT_MS), false);
  assert.equal(isGoldSegment(snapshot, MIN_GOLD_SEGMENT_MS + 1), true);
});
