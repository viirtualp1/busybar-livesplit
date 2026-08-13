import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACK } from '../src/bar/layout.js';
import { COLORS } from '../src/view/colors.js';
import { buildFrame } from '../src/view/frame.js';
import { makeSnapshot, makeSplits } from './helpers.js';

const options = { nowMs: 0, maxRows: BACK.maxRows };

test('idle run shows READY in the muted colour', () => {
  const frame = buildFrame(makeSnapshot({ attemptCount: 7 }), options);
  assert.equal(frame.splitText, 'READY');
  assert.equal(frame.timeText, '0:00.00');
  assert.equal(frame.timeColor, COLORS.notRunning);
  assert.equal(frame.deltaText, '');
  assert.equal(frame.attemptText, '#7');
});

test('running ahead is green, losing time is red', () => {
  const ahead = buildFrame(
    makeSnapshot({ phase: 'Running', splitName: 'Cave', liveDeltaMs: -2000 }),
    options,
  );
  assert.equal(ahead.timeColor, COLORS.aheadGaining);
  assert.equal(ahead.splitText, 'Cave');

  const behind = buildFrame(
    makeSnapshot({ phase: 'Running', liveDeltaMs: 2000, lastDeltaMs: 1000 }),
    options,
  );
  assert.equal(behind.timeColor, COLORS.behindLosing);
  assert.equal(behind.deltaText, '+2.0');
});

test('a finished run is cyan on a pb and red otherwise', () => {
  const pb = buildFrame(makeSnapshot({ phase: 'Ended', liveDeltaMs: -500 }), options);
  assert.equal(pb.timeColor, COLORS.personalBest);
  assert.equal(pb.splitText, 'DONE');

  const lost = buildFrame(makeSnapshot({ phase: 'Ended', liveDeltaMs: 500 }), options);
  assert.equal(lost.timeColor, COLORS.behindLosing);
});

test('gold paints the delta yellow', () => {
  const frame = buildFrame(
    makeSnapshot({
      phase: 'Running',
      liveDeltaMs: 4000,
      liveSegmentMs: 3000,
      bestSegmentMs: 5000,
    }),
    options,
  );
  assert.equal(frame.deltaColor, COLORS.bestSegment);
});

test('paused keeps the split name and dims it', () => {
  const frame = buildFrame(makeSnapshot({ phase: 'Paused', splitName: 'Boss' }), options);
  assert.equal(frame.splitText, 'Boss');
  assert.equal(frame.splitColor, COLORS.paused);
});

test('the back window follows the current split', () => {
  const frame = buildFrame(
    makeSnapshot({ phase: 'Running', splitIndex: 5, splits: makeSplits(10) }),
    options,
  );
  assert.equal(frame.backRows.length, BACK.maxRows);
  assert.equal(frame.backRows[0]?.name, 'Split 5');
  assert.equal(frame.backRows[1]?.current, true);
  assert.equal(frame.backRows[1]?.color, COLORS.highlight);
});

test('the back window stops at the last split', () => {
  const frame = buildFrame(
    makeSnapshot({ phase: 'Running', splitIndex: 9, splits: makeSplits(10) }),
    options,
  );
  assert.equal(frame.backRows.at(-1)?.name, 'Split 10');
  assert.equal(frame.backRows.length, BACK.maxRows);
});

test('the running split shows the live time, past splits their own', () => {
  const splits = makeSplits(3);
  splits[0] = { name: 'One', pbMs: 12_000, runMs: 11_500 };
  const frame = buildFrame(
    makeSnapshot({
      phase: 'Running',
      splitIndex: 1,
      timeMs: 20_000,
      receivedAt: 0,
      splits,
    }),
    options,
  );
  assert.equal(frame.backRows[0]?.time, '11.5');
  assert.equal(frame.backRows[0]?.pb, '12.0');
  assert.equal(frame.backRows[1]?.time, '20.0');
});

test('the timer advances between polls without a new snapshot', () => {
  const snapshot = makeSnapshot({ phase: 'Running', timeMs: 5000, receivedAt: 0 });
  assert.equal(buildFrame(snapshot, options).timeText, '0:05.00');
  assert.equal(buildFrame(snapshot, { ...options, nowMs: 250 }).timeText, '0:05.25');
});

test('flash events map to led colours', () => {
  const snapshot = makeSnapshot({ phase: 'Running' });
  assert.equal(buildFrame(snapshot, options).ledColor, null);
  assert.equal(
    buildFrame(snapshot, { ...options, flash: 'reset' }).ledColor,
    COLORS.ledReset,
  );
  assert.equal(buildFrame(snapshot, { ...options, flash: 'pb' }).ledColor, COLORS.ledPb);
});
