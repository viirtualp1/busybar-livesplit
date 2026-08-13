import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTimerPhase,
  parseLiveSplitTime,
  replyValue,
  sanitizeSplitName,
} from '../src/livesplit/types.js';

test('treats placeholders and server errors as missing values', () => {
  assert.equal(replyValue('00:00:12.34'), '00:00:12.34');
  assert.equal(replyValue(null), null);
  assert.equal(replyValue(''), null);
  assert.equal(replyValue('  '), null);
  assert.equal(replyValue('-'), null);
  assert.equal(replyValue('?'), null);
  assert.equal(replyValue('[Error]: System.Exception: Unrecognized command: "x"'), null);
});

test('parses hours, minutes and seconds', () => {
  assert.equal(parseLiveSplitTime('00:00:12.34'), 12_340);
  assert.equal(parseLiveSplitTime('01:02:03.5'), 3_723_500);
  assert.equal(parseLiveSplitTime('2:03.5'), 123_500);
  assert.equal(parseLiveSplitTime('12.34'), 12_340);
});

test('parses negative times', () => {
  assert.equal(parseLiveSplitTime('-00:00:01.5'), -1500);
  assert.equal(parseLiveSplitTime('-2:00.0'), -120_000);
});

test('treats null markers and junk as no value', () => {
  assert.equal(parseLiveSplitTime('-'), null);
  assert.equal(parseLiveSplitTime('?'), null);
  assert.equal(parseLiveSplitTime(''), null);
  assert.equal(parseLiveSplitTime('   '), null);
  assert.equal(parseLiveSplitTime('nope'), null);
});

test('rejects more components than hours:minutes:seconds instead of guessing', () => {
  assert.equal(parseLiveSplitTime('1:2:3:4'), null);
});

test('transliterates non-ascii split names', () => {
  assert.equal(sanitizeSplitName('Уровень 1'), 'Uroven 1');
  assert.equal(sanitizeSplitName('Шахта'), 'Shahta');
  assert.equal(sanitizeSplitName('Café'), 'Cafe');
});

test('collapses whitespace and empty markers', () => {
  assert.equal(sanitizeSplitName('  Split   two '), 'Split two');
  assert.equal(sanitizeSplitName('-'), '');
  assert.equal(sanitizeSplitName(''), '');
});

test('recognises timer phases', () => {
  assert.equal(isTimerPhase('Running'), true);
  assert.equal(isTimerPhase('running'), false);
  assert.equal(isTimerPhase('12.34'), false);
});
