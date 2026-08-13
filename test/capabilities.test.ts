import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerCapabilities, type ProbeChannel } from '../src/livesplit/capabilities.js';
import { LiveSplitTimeoutError } from '../src/livesplit/connection.js';

class FakeProbes implements ProbeChannel {
  probed: string[] = [];

  constructor(private readonly replies: Record<string, string | null | Error>) {}

  async trySend(command: string): Promise<string | null> {
    this.probed.push(command);
    const reply = this.replies[command];
    if (reply instanceof Error) {
      throw reply;
    }
    return reply ?? null;
  }
}

const modern = {
  getsplitcount: '4',
  'getsplitname 0': 'One',
  getattemptcount: '7',
  'getcomparisonsplittime Best Segments': '00:00:18.00',
};

test('a modern server supports every optional command', async () => {
  const capabilities = new ServerCapabilities();
  await capabilities.detect(new FakeProbes(modern));

  assert.equal(capabilities.complete, true);
  assert.equal(capabilities.supports('splitCount'), true);
  assert.equal(capabilities.supports('splitNames'), true);
  assert.equal(capabilities.supports('attemptCount'), true);
  assert.equal(capabilities.supports('bestSegments'), true);
});

test('a silent server supports none of them', async () => {
  const capabilities = new ServerCapabilities();
  await capabilities.detect(new FakeProbes({}));

  assert.equal(capabilities.complete, true);
  assert.equal(capabilities.supports('splitCount'), false);
  assert.equal(capabilities.supports('attemptCount'), false);
});

test('an error reply counts as unsupported', async () => {
  const capabilities = new ServerCapabilities();
  await capabilities.detect(
    new FakeProbes({
      ...modern,
      getsplitcount: '[Error]: System.Exception: Unrecognized command: "getsplitcount"',
    }),
  );

  assert.equal(capabilities.supports('splitCount'), false);
  assert.equal(capabilities.supports('splitNames'), true);
});

test('detection runs once, not on every call', async () => {
  const capabilities = new ServerCapabilities();
  const channel = new FakeProbes(modern);
  await capabilities.detect(channel);
  await capabilities.detect(channel);

  assert.equal(channel.probed.length, 4);
});

test('a probe that kills the connection retires the feature', async () => {
  const capabilities = new ServerCapabilities();
  const channel = new FakeProbes({
    ...modern,
    getattemptcount: new LiveSplitTimeoutError('getcurrenttimerphase'),
  });

  await assert.rejects(capabilities.detect(channel), /timeout/i);
  assert.equal(capabilities.supports('attemptCount'), false);

  await capabilities.detect(channel);
  assert.equal(
    channel.probed.filter((command) => command === 'getattemptcount').length,
    1,
  );
  assert.equal(capabilities.complete, true);
});

test('a dropped connection leaves the feature open for a retry', async () => {
  const capabilities = new ServerCapabilities();
  const channel = new FakeProbes({
    ...modern,
    getattemptcount: new Error('LiveSplit connection closed'),
  });

  await assert.rejects(capabilities.detect(channel), /closed/i);
  assert.equal(capabilities.complete, false);

  await capabilities.detect(new FakeProbes(modern));
  assert.equal(capabilities.supports('attemptCount'), true);
});
