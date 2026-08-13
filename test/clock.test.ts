import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  interpolatedDeltaMs,
  interpolatedSegmentMs,
  interpolatedTimeMs,
} from '../src/domain/clock.js';
import { makeSnapshot } from './helpers.js';

test('advances the timer between polls while running', () => {
  const snapshot = makeSnapshot({ phase: 'Running', timeMs: 10_000, receivedAt: 500 });
  assert.equal(interpolatedTimeMs(snapshot, 500), 10_000);
  assert.equal(interpolatedTimeMs(snapshot, 580), 10_080);
});

test('freezes the timer when not running', () => {
  for (const phase of ['NotRunning', 'Paused', 'Ended'] as const) {
    const snapshot = makeSnapshot({ phase, timeMs: 10_000, receivedAt: 500 });
    assert.equal(interpolatedTimeMs(snapshot, 5000), 10_000);
  }
});

test('never goes backwards if the clock jitters', () => {
  const snapshot = makeSnapshot({ phase: 'Running', timeMs: 10_000, receivedAt: 500 });
  assert.equal(interpolatedTimeMs(snapshot, 400), 10_000);
});

test('delta and segment advance with the timer', () => {
  const snapshot = makeSnapshot({
    phase: 'Running',
    timeMs: 10_000,
    receivedAt: 0,
    liveDeltaMs: -2000,
    liveSegmentMs: 3000,
  });
  assert.equal(interpolatedDeltaMs(snapshot, 250), -1750);
  assert.equal(interpolatedSegmentMs(snapshot, 250), 3250);
});

test('unknown delta and segment stay unknown', () => {
  const snapshot = makeSnapshot({ phase: 'Running', receivedAt: 0 });
  assert.equal(interpolatedDeltaMs(snapshot, 250), null);
  assert.equal(interpolatedSegmentMs(snapshot, 250), null);
});
