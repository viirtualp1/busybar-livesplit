import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectEvent, initialEventState } from '../src/domain/events.js';
import { makeSnapshot } from './helpers.js';

test('stays silent on the very first poll', () => {
  const { event, state } = detectEvent(
    initialEventState,
    makeSnapshot({ phase: 'Running', splitIndex: 2 }),
  );
  assert.equal(event, null);
  assert.deepEqual(state, { phase: 'Running', splitIndex: 2 });
});

test('detects start, split and reset', () => {
  const idle = { phase: 'NotRunning' as const, splitIndex: -1 };
  assert.equal(
    detectEvent(idle, makeSnapshot({ phase: 'Running', splitIndex: 0 })).event,
    'start',
  );

  const running = { phase: 'Running' as const, splitIndex: 0 };
  assert.equal(
    detectEvent(running, makeSnapshot({ phase: 'Running', splitIndex: 1 })).event,
    'split',
  );
  assert.equal(
    detectEvent(running, makeSnapshot({ phase: 'NotRunning', splitIndex: -1 })).event,
    'reset',
  );
});

test('a finished run is a pb only when ahead of the comparison', () => {
  const running = { phase: 'Running' as const, splitIndex: 4 };

  assert.equal(
    detectEvent(running, makeSnapshot({ phase: 'Ended', liveDeltaMs: -1500 })).event,
    'pb',
  );
  assert.equal(
    detectEvent(running, makeSnapshot({ phase: 'Ended', liveDeltaMs: 900 })).event,
    'split',
  );
  assert.equal(
    detectEvent(running, makeSnapshot({ phase: 'Ended', liveDeltaMs: null })).event,
    'pb',
  );
});

test('does not repeat the finish event while ended', () => {
  const ended = { phase: 'Ended' as const, splitIndex: 5 };
  assert.equal(detectEvent(ended, makeSnapshot({ phase: 'Ended' })).event, null);
});

test('ignores a split jump before the run has an index', () => {
  const running = { phase: 'Running' as const, splitIndex: -1 };
  assert.equal(
    detectEvent(running, makeSnapshot({ phase: 'Running', splitIndex: 0 })).event,
    null,
  );
});
