import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACK, clipToWidth, FRONT, rowY, textWidth } from '../src/bar/layout.js';

const LONGEST_SPLIT_TIME = '1:05:30';

test('every back row fits on the screen', () => {
  const lastRowBottom = rowY(BACK.maxRows - 1) + BACK.rowHeight;
  assert.ok(BACK.maxRows > 0);
  assert.ok(lastRowBottom <= BACK.height, `${lastRowBottom} > ${BACK.height}`);
});

test('the time column is wide enough for an hour-long split', () => {
  const columnWidth = BACK.timeRight - (BACK.nameX + BACK.nameWidth);
  assert.ok(
    textWidth(LONGEST_SPLIT_TIME, 'small') <= columnWidth,
    `${LONGEST_SPLIT_TIME} needs ${textWidth(LONGEST_SPLIT_TIME, 'small')}px, column is ${columnWidth}px`,
  );
});

test('the pb column stays on screen', () => {
  assert.ok(BACK.pbRight <= BACK.width);
  assert.ok(BACK.timeRight < BACK.pbRight);
});

test('short text is left alone', () => {
  assert.equal(clipToWidth('Cave', 72, 'tiny'), 'Cave');
});

test('long text is truncated to fit its box', () => {
  const clipped = clipToWidth('A very long split name', 24, 'tiny');
  assert.equal(clipped, 'A very..');
  assert.ok(textWidth(clipped, 'tiny') <= 24);
});

test('a tiny box still returns something drawable', () => {
  assert.equal(clipToWidth('abcdef', 6, 'tiny'), 'ab');
  assert.equal(clipToWidth('abcdef', 1, 'tiny'), 'a');
});

test('the delta slot leaves room for the split name', () => {
  assert.ok(FRONT.deltaWidth < FRONT.width);
});
