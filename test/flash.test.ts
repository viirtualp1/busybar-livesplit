import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FlashWindow } from '../src/domain/flash.js';

test('a flash stays active for its duration', () => {
  const flash = new FlashWindow(100);
  flash.trigger('split', 1000);

  assert.equal(flash.active(1000), 'split');
  assert.equal(flash.active(1099), 'split');
  assert.equal(flash.active(1100), null);
});

test('a new event replaces the previous one', () => {
  const flash = new FlashWindow(100);
  flash.trigger('split', 1000);
  flash.trigger('pb', 1050);

  assert.equal(flash.active(1120), 'pb');
});

test('nothing is active before any event', () => {
  assert.equal(new FlashWindow().active(0), null);
});

test('a null event does not extend the window', () => {
  const flash = new FlashWindow(100);
  flash.trigger('reset', 0);
  flash.trigger(null, 50);
  assert.equal(flash.active(99), 'reset');
  assert.equal(flash.active(100), null);
});
