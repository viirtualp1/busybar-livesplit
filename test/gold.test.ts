import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGoldSegment, MIN_GOLD_SEGMENT_MS } from '../src/domain/gold.js';
import { makeSnapshot } from './helpers.js';

test('gold needs a known best segment and a shorter one', () => {
  assert.equal(
    isGoldSegment(makeSnapshot({ lastSegmentMs: 4000, lastBestSegmentMs: 5000 })),
    true,
  );
  assert.equal(
    isGoldSegment(makeSnapshot({ lastSegmentMs: 6000, lastBestSegmentMs: 5000 })),
    false,
  );
});

test('an unknown best segment never counts as gold', () => {
  assert.equal(
    isGoldSegment(makeSnapshot({ lastSegmentMs: 1000, lastBestSegmentMs: null })),
    false,
  );
});

test('an unknown segment length never counts as gold', () => {
  assert.equal(
    isGoldSegment(makeSnapshot({ lastSegmentMs: null, lastBestSegmentMs: 5000 })),
    false,
  );
});

test('a segment too short to be real is not gold', () => {
  assert.equal(
    isGoldSegment(
      makeSnapshot({ lastSegmentMs: MIN_GOLD_SEGMENT_MS, lastBestSegmentMs: 5000 }),
    ),
    false,
  );
  assert.equal(
    isGoldSegment(
      makeSnapshot({ lastSegmentMs: MIN_GOLD_SEGMENT_MS + 1, lastBestSegmentMs: 5000 }),
    ),
    true,
  );
});
