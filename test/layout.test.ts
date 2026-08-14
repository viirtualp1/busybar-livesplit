import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACK, clipToWidth, FRONT, rowY, textWidth } from '../src/bar/layout.js';
import { MAX_DELTA_CHARS } from '../src/view/time.js';

const LONGEST_SPLIT_TIME = '1:05:30';

test('every back row fits on the screen', () => {
  const lastRowBottom = rowY(BACK.maxRows - 1) + BACK.rowHeight;
  assert.ok(BACK.maxRows > 0);
  assert.ok(lastRowBottom <= BACK.height, `${lastRowBottom} > ${BACK.height}`);
});

test('the time column is wide enough for an hour-long split', () => {
  const columnWidth = BACK.pbX - BACK.timeX;
  assert.ok(
    textWidth(LONGEST_SPLIT_TIME, 'tiny') <= columnWidth,
    `${LONGEST_SPLIT_TIME} needs ${textWidth(LONGEST_SPLIT_TIME, 'tiny')}px, column is ${columnWidth}px`,
  );
});

test('the pb column stays on screen', () => {
  const right = BACK.pbX + textWidth(LONGEST_SPLIT_TIME, 'tiny');
  assert.ok(right <= BACK.width, `${right} > ${BACK.width}`);
  assert.ok(BACK.timeX > BACK.nameX + BACK.nameWidth);
  assert.ok(BACK.pbX > BACK.timeX);
});

test('short text is left alone', () => {
  assert.equal(clipToWidth('Cave', 72, 'tiny'), 'Cave');
});

test('long text is truncated to fit its box', () => {
  const clipped = clipToWidth('A very long split name', 24, 'tiny');
  assert.equal(clipped, 'A ve..');
  assert.ok(textWidth(clipped, 'tiny') <= 24);
});

test('a tiny box still returns something drawable', () => {
  assert.equal(clipToWidth('abcdef', 8, 'tiny'), 'ab');
  assert.equal(clipToWidth('abcdef', 1, 'tiny'), 'a');
});

test('the delta slot leaves room for the split name', () => {
  assert.ok(FRONT.deltaWidth < FRONT.width);
});

test('the widest delta fits its slot', () => {
  const widest = '+'.padEnd(MAX_DELTA_CHARS, '9');
  assert.ok(
    textWidth(widest, 'tiny') <= FRONT.deltaWidth,
    `${widest} needs ${textWidth(widest, 'tiny')}px, slot is ${FRONT.deltaWidth}px`,
  );
});
