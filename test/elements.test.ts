import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptElements, backElements } from '../src/bar/elements.js';
import { BACK, textWidth, type BarFont } from '../src/bar/layout.js';
import { GLYPH_HEIGHT, MAX_ATTEMPT_DIGITS, RUNS_PER_ROW } from '../src/bar/pixel-font.js';
import { COLORS } from '../src/view/colors.js';
import { buildFrame } from '../src/view/frame.js';
import { makeSnapshot, makeSplits } from './helpers.js';

const EXPECTED_ATTEMPT_ELEMENTS = MAX_ATTEMPT_DIGITS * GLYPH_HEIGHT * RUNS_PER_ROW;

test('the attempt counter always emits the same ids', () => {
  const few = attemptElements('#7');
  const many = attemptElements('#1234');

  assert.equal(few.length, EXPECTED_ATTEMPT_ELEMENTS);
  assert.equal(many.length, EXPECTED_ATTEMPT_ELEMENTS);
  assert.deepEqual(
    few.map((element) => element.id),
    many.map((element) => element.id),
  );
});

test('ids are unique so nothing overwrites a neighbour', () => {
  const ids = attemptElements('#88888').map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('unused digit slots are transparent', () => {
  const elements = attemptElements('#1');
  const visible = elements.filter(
    (element) => element.fill_colors?.[0] === COLORS.attempt,
  );
  assert.ok(visible.length > 0);
  assert.ok(visible.length < EXPECTED_ATTEMPT_ELEMENTS);
});

test('a missing counter still draws a zero', () => {
  const elements = attemptElements('');
  const visible = elements.filter(
    (element) => element.fill_colors?.[0] === COLORS.attempt,
  );
  assert.ok(visible.length > 0);
});

test('the back screen always emits every row slot', () => {
  const short = backElements(
    buildFrame(makeSnapshot({ phase: 'Running', splits: makeSplits(2) }), {
      nowMs: 0,
      maxRows: BACK.maxRows,
    }),
  );
  const full = backElements(
    buildFrame(makeSnapshot({ phase: 'Running', splits: makeSplits(9) }), {
      nowMs: 0,
      maxRows: BACK.maxRows,
    }),
  );

  assert.equal(short.length, full.length);
  assert.deepEqual(
    short.map((element) => element.id),
    full.map((element) => element.id),
  );
});

test('every element stays inside the back screen', () => {
  const elements = backElements(
    buildFrame(makeSnapshot({ phase: 'Running', splits: makeSplits(9) }), {
      nowMs: 0,
      maxRows: BACK.maxRows,
    }),
  );
  for (const element of elements) {
    assert.ok(element.x >= 0, `${element.id} at x=${element.x}`);
    assert.ok(element.y < BACK.height, `${element.id} at y=${element.y}`);
    const font = (element.font ?? 'tiny') as BarFont;
    const right = element.x + textWidth(element.text, font);
    assert.ok(right <= BACK.width, `${element.id} ends at ${right}`);
  }
});

test('the pb column is on-screen and opaque', () => {
  const splits = makeSplits(2);
  splits[0] = { name: 'One', pbMs: 12_000, runMs: null };
  const elements = backElements(
    buildFrame(makeSnapshot({ splits }), { nowMs: 0, maxRows: BACK.maxRows }),
  );
  const pb = elements.find((element) => element.id === 'b0-pb');
  assert.equal(pb?.x, BACK.pbX);
  assert.equal(pb?.text, '0:12');
  assert.equal(pb?.color, COLORS.white);
  assert.ok((pb?.x ?? 0) + textWidth(pb?.text ?? '', 'tiny') <= BACK.width);
});
