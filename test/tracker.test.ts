import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunTracker, type CommandChannel } from '../src/livesplit/tracker.js';

type Replies = Record<string, string | null>;

class FakeChannel implements CommandChannel {
  connected = true;
  sent: string[] = [];

  constructor(private replies: Replies) {}

  set(replies: Replies): void {
    this.replies = replies;
  }

  async send(command: string): Promise<string> {
    this.sent.push(command);
    const reply = this.lookup(command);
    if (reply === null) {
      throw new Error(`LiveSplit timeout: ${command}`);
    }
    return reply;
  }

  async probe(command: string): Promise<string | null> {
    this.sent.push(command);
    return this.lookup(command);
  }

  since(marker: number): string[] {
    return this.sent.slice(marker);
  }

  private lookup(command: string): string | null {
    return this.replies[command] ?? null;
  }
}

function runningReplies(overrides: Replies = {}): Replies {
  return {
    getcurrenttimerphase: 'Running',
    getcurrenttime: '00:00:30.00',
    getsplitindex: '1',
    getsplitcount: '3',
    'getsplitname 0': 'One',
    'getsplitname 1': 'Two',
    'getsplitname 2': 'Three',
    getattemptcount: '12',
    getdelta: '-00:00:02.00',
    getlastsplittime: '00:00:20.00',
    getcomparisonsplittime: '00:00:35.00',
    'getcomparisonsplittime Best Segments': '00:00:18.00',
    getcurrentsplitname: 'Two',
    getprevioussplitname: 'One',
    ...overrides,
  };
}

let clock = 0;
function tracker(channel: CommandChannel): RunTracker {
  return new RunTracker(channel, () => clock);
}

test('a first poll collects names, attempts and comparisons', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const snapshot = await tracker(channel).poll();

  assert.equal(snapshot.phase, 'Running');
  assert.equal(snapshot.timeMs, 30_000);
  assert.equal(snapshot.splitIndex, 1);
  assert.equal(snapshot.attemptCount, 12);
  assert.equal(snapshot.splitName, 'Two');
  assert.deepEqual(
    snapshot.splits.map((split) => split.name),
    ['One', 'Two', 'Three'],
  );
  assert.equal(snapshot.liveDeltaMs, -5000);
  assert.equal(snapshot.liveSegmentMs, 10_000);
});

test('a steady frame costs three commands', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  const marker = channel.sent.length;
  await run.poll();

  assert.deepEqual(channel.since(marker), [
    'getcurrenttimerphase',
    'getcurrenttime',
    'getsplitindex',
  ]);
});

test('a split refreshes the cached comparison', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  channel.set(
    runningReplies({
      getsplitindex: '2',
      getcurrentsplitname: 'Three',
      getlastsplittime: '00:00:31.00',
      getcomparisonsplittime: '00:01:05.00',
      'getcomparisonsplittime Best Segments': '00:00:50.00',
    }),
  );
  const snapshot = await run.poll();

  assert.equal(snapshot.splitName, 'Three');
  assert.equal(snapshot.splits[1]?.runMs, 31_000);
  assert.equal(snapshot.liveDeltaMs, 30_000 - 65_000);
});

test('an unreached previous split leaves the best segment unknown', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({
      getsplitindex: '2',
      'getcomparisonsplittime Best Segments': '00:00:50.00',
    }),
  );
  const snapshot = await tracker(channel).poll();

  assert.equal(snapshot.bestSegmentMs, null);
});

test('the first split compares against the start', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({
      getsplitindex: '0',
      getlastsplittime: '-',
      'getcomparisonsplittime Best Segments': '00:00:18.00',
    }),
  );
  const snapshot = await tracker(channel).poll();

  assert.equal(snapshot.bestSegmentMs, 18_000);
  assert.equal(snapshot.liveSegmentMs, 30_000);
});

test('a different run with the same split count reloads the names', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({ getcurrenttimerphase: 'NotRunning', getsplitindex: '-1' }),
  );
  const run = tracker(channel);
  await run.poll();

  channel.set(
    runningReplies({
      getcurrenttimerphase: 'NotRunning',
      getsplitindex: '-1',
      'getsplitname 0': 'Alpha',
      'getsplitname 1': 'Beta',
      'getsplitname 2': 'Gamma',
    }),
  );
  clock += 5000;
  const snapshot = await run.poll();

  assert.deepEqual(
    snapshot.splits.map((split) => split.name),
    ['Alpha', 'Beta', 'Gamma'],
  );
});

test('an unchanged run is not reloaded on every idle poll', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({ getcurrenttimerphase: 'NotRunning', getsplitindex: '-1' }),
  );
  const run = tracker(channel);
  await run.poll();

  clock += 5000;
  const marker = channel.sent.length;
  await run.poll();

  assert.equal(channel.since(marker).includes('getsplitname 1'), false);
});

test('unsupported commands are probed once and then skipped', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies({ getattemptcount: null }));
  const run = tracker(channel);
  await run.poll();

  channel.set(runningReplies({ getattemptcount: null, getcurrenttimerphase: 'Paused' }));
  const marker = channel.sent.length;
  const snapshot = await run.poll();

  assert.equal(channel.since(marker).includes('getattemptcount'), false);
  assert.equal(snapshot.attemptCount, 0);
});

test('a missing split count falls back to probing names', async () => {
  clock = 0;
  const replies = runningReplies({ getsplitcount: null });
  const channel = new FakeChannel(replies);
  const snapshot = await tracker(channel).poll();

  assert.deepEqual(
    snapshot.splits.map((split) => split.name),
    ['One', 'Two', 'Three'],
  );
});

test('a reset run clears the recorded times', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  channel.set(
    runningReplies({ getcurrenttimerphase: 'NotRunning', getsplitindex: '-1' }),
  );
  clock += 5000;
  const snapshot = await run.poll();

  assert.equal(
    snapshot.splits.every((split) => split.runMs === null),
    true,
  );
  assert.equal(snapshot.liveSegmentMs, null);
  assert.equal(snapshot.splitName, '');
});

test('reset() drops every cache so a reconnect re-probes', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  run.reset();
  const marker = channel.sent.length;
  await run.poll();

  assert.ok(channel.since(marker).includes('getsplitname 1'));
});
