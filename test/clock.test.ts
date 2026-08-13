import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolatedDeltaMs, interpolatedTimeMs } from '../src/domain/clock.js';
import { makeSnapshot } from './helpers.js';

test('advances the timer between polls while running', () => {
  const snapshot = makeSnapshot({
    phase: 'Running',
    timeMs: 10_000,
    receivedAt: 500,
    advancing: true,
  });
  assert.equal(interpolatedTimeMs(snapshot, 500), 10_000);
  assert.equal(interpolatedTimeMs(snapshot, 580), 10_080);
});

/** A run clock that stands still under a Running phase must not be extrapolated. */
test('freezes the timer until the polls confirm it moves', () => {
  const snapshot = makeSnapshot({
    phase: 'Running',
    timeMs: 10_000,
    receivedAt: 500,
    advancing: false,
  });
  assert.equal(interpolatedTimeMs(snapshot, 5000), 10_000);
});

test('freezes the timer when not running', () => {
  for (const phase of ['NotRunning', 'Paused', 'Ended'] as const) {
    const snapshot = makeSnapshot({ phase, timeMs: 10_000, receivedAt: 500 });
    assert.equal(interpolatedTimeMs(snapshot, 5000), 10_000);
  }
});

test('never goes backwards if the clock jitters', () => {
  const snapshot = makeSnapshot({
    phase: 'Running',
    timeMs: 10_000,
    receivedAt: 500,
    advancing: true,
  });
  assert.equal(interpolatedTimeMs(snapshot, 400), 10_000);
});

test('the delta advances with the timer', () => {
  const snapshot = makeSnapshot({
    phase: 'Running',
    timeMs: 10_000,
    receivedAt: 0,
    advancing: true,
    liveDeltaMs: -2000,
  });
  assert.equal(interpolatedDeltaMs(snapshot, 250), -1750);
});

test('an unknown delta stays unknown', () => {
  const snapshot = makeSnapshot({ phase: 'Running', receivedAt: 0 });
  assert.equal(interpolatedDeltaMs(snapshot, 250), null);
});
