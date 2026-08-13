import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SPLIT_NAME_LETTERS, truncateName } from '../src/view/text.js';

test('a short name is left alone', () => {
  assert.equal(truncateName('Boss'), 'Boss');
  assert.equal(truncateName(''), '');
  assert.equal(truncateName('Sewers Key'), 'Sewers Key'); // exactly ten letters
});

test('a long name is cut after ten letters', () => {
  assert.equal(truncateName('Undergrounds'), 'Undergroun...');
  assert.equal(truncateName('The Great Hall'), 'The Great Ha...');
});

test('spaces do not count towards the limit', () => {
  assert.equal(truncateName('A B C D E F G H I J'), 'A B C D E F G H I J');
  assert.equal(truncateName('A B C D E F G H I J K'), 'A B C D E F G H I J...');
});

test('the cut never leaves a trailing space before the dots', () => {
  assert.equal(truncateName('First Floor Boss'), 'First Floor...');
  assert.equal(truncateName('Castle Two Towers'), 'Castle Two T...');
});

test('the limit can be tightened', () => {
  assert.equal(truncateName('Abcdef', 3), 'Abc...');
  assert.equal(MAX_SPLIT_NAME_LETTERS, 10);
});
