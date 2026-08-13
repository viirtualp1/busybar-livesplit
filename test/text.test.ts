import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SPLIT_NAME_LETTERS, truncateName } from '../src/view/text.js';

test('a short name is left alone', () => {
  assert.equal(truncateName('Boss'), 'Boss');
  assert.equal(truncateName(''), '');
  assert.equal(truncateName('Sewer Key'), 'Sewer Key'); // exactly eight letters
});

test('a long name is cut after eight letters', () => {
  assert.equal(truncateName('Undergrounds'), 'Undergro...');
  assert.equal(truncateName('First Floor Boss'), 'First Flo...');
});

test('spaces do not count towards the limit', () => {
  assert.equal(truncateName('A B C D E F G H'), 'A B C D E F G H');
  assert.equal(truncateName('A B C D E F G H I'), 'A B C D E F G H...');
});

test('the cut never leaves a trailing space before the dots', () => {
  assert.equal(truncateName('The Great Hall'), 'The Great...');
  assert.equal(truncateName('Castle Two Towers'), 'Castle Tw...');
});

test('the limit can be tightened', () => {
  assert.equal(truncateName('Abcdef', 3), 'Abc...');
  assert.equal(MAX_SPLIT_NAME_LETTERS, 8);
});
