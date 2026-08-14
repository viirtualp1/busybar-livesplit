import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, isCloudAddr, isUsbAddr, loadConfig } from '../src/config.js';

test('defaults to usb without a token and to cloud with one', () => {
  assert.equal(loadConfig({}).config.busyAddr, DEFAULTS.usbAddr);
  assert.equal(loadConfig({ BUSY_TOKEN: 'abc' }).config.busyAddr, DEFAULTS.cloudAddr);
});

test('recognises cloud and usb addresses', () => {
  assert.equal(isCloudAddr('https://api.busy.app'), true);
  assert.equal(isCloudAddr('https://api.dev.busy.app'), true);
  assert.equal(isCloudAddr('192.168.1.42'), false);
  assert.equal(isUsbAddr('10.0.4.20'), true);
  assert.equal(isUsbAddr('http://10.0.4.20'), true);
  assert.equal(isUsbAddr('192.168.1.42'), false);
});

test('keeps the cloud token only on cloud', () => {
  const cloud = loadConfig({ BUSY_ADDR: 'https://api.busy.app', BUSY_TOKEN: 'abc' });
  assert.equal(cloud.config.busyToken, 'abc');

  const lan = loadConfig({ BUSY_ADDR: '192.168.1.42', BUSY_TOKEN: 'abc' });
  assert.equal(lan.config.busyToken, '');
  assert.ok(lan.warnings.some((warning) => warning.includes('BUSY_TOKEN is ignored')));
});

test('keeps the http password only on wi-fi', () => {
  const wifi = loadConfig({ BUSY_ADDR: '192.168.1.42', BUSY_HTTP_PASSWORD: 'pw' });
  assert.equal(wifi.config.busyHttpPassword, 'pw');
  assert.deepEqual(wifi.warnings, []);

  const usb = loadConfig({ BUSY_ADDR: '10.0.4.20', BUSY_HTTP_PASSWORD: 'pw' });
  assert.equal(usb.config.busyHttpPassword, '');
  assert.ok(usb.warnings.some((warning) => warning.includes('USB')));
});

test('warns when wi-fi has no password at all', () => {
  const { warnings } = loadConfig({ BUSY_ADDR: '192.168.1.42' });
  assert.ok(warnings.some((warning) => warning.includes('BUSY_HTTP_PASSWORD')));
});

test('clamps numbers into a usable range', () => {
  const { config, warnings } = loadConfig({ POLL_MS: '0', FRAME_MS: '100000' });
  assert.ok(config.pollMs >= 40);
  assert.ok(config.frameMs <= 1000);
  assert.equal(warnings.length, 2);
});

test('falls back on values that are not numbers', () => {
  const { config, warnings } = loadConfig({ DRAW_PRIORITY: 'high' });
  assert.equal(config.drawPriority, DEFAULTS.drawPriority);
  assert.ok(warnings.some((warning) => warning.includes('DRAW_PRIORITY')));
});

test('warns when SPLITS_FILE points at nothing', () => {
  const { warnings, config } = loadConfig({ SPLITS_FILE: 'C:\\missing\\run.lss' });
  assert.equal(config.splitsFile, 'C:\\missing\\run.lss');
  assert.ok(warnings.some((warning) => warning.includes('SPLITS_FILE')));
});

test('accepts known protocols and warns on the rest', () => {
  assert.equal(loadConfig({ LIVESPLIT_PROTOCOL: 'ws' }).config.liveSplitProtocol, 'ws');
  assert.equal(loadConfig({ LIVESPLIT_PROTOCOL: 'TCP' }).config.liveSplitProtocol, 'tcp');

  const bad = loadConfig({ LIVESPLIT_PROTOCOL: 'serial' });
  assert.equal(bad.config.liveSplitProtocol, 'auto');
  assert.ok(bad.warnings.some((warning) => warning.includes('LIVESPLIT_PROTOCOL')));
});
