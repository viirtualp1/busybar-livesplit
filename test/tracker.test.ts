import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveSplitTimeoutError } from '../src/livesplit/connection.js';
import { RunTracker, type CommandChannel } from '../src/livesplit/tracker.js';

type Replies = Record<string, string | null>;

class FakeChannel implements CommandChannel {
  connected = true;
  sent: string[] = [];
  probed: string[] = [];

  constructor(private replies: Replies) {}

  set(replies: Replies): void {
    this.replies = replies;
  }

  async send(command: string): Promise<string> {
    this.sent.push(command);
    const reply = this.lookup(command);
    if (reply === null) {
      throw new LiveSplitTimeoutError(command);
    }
    return reply;
  }

  async trySend(command: string): Promise<string | null> {
    this.sent.push(command);
    this.probed.push(command);
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
  assert.equal(snapshot.lastSegmentMs, 20_000);
  assert.equal(snapshot.lastBestSegmentMs, null); // split 0 was never polled
});

/** Only the commands older builds lack may be probed; the rest must be sent plainly. */
test('feature detection probes optional commands once', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  assert.deepEqual(channel.probed, [
    'getsplitcount',
    'getsplitname 0',
    'getattemptcount',
    'getcomparisonsplittime Best Segments',
  ]);

  const marker = channel.probed.length;
  await run.poll();
  assert.deepEqual(channel.probed.slice(marker), []);
});

test('the timer is only marked advancing once two polls see it move', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);

  assert.equal((await run.poll()).advancing, false);

  clock += 250;
  channel.set(runningReplies({ getcurrenttime: '00:00:30.25' }));
  assert.equal((await run.poll()).advancing, true);
});

/** LiveSplit stays in Running while game time is paused, and then time stands still. */
test('a stalled clock under a running phase is not advancing', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  clock += 250;
  channel.set(runningReplies({ getcurrenttime: '00:00:30.25' }));
  await run.poll();

  clock += 250;
  const snapshot = await run.poll();

  assert.equal(snapshot.advancing, false);
  assert.equal(snapshot.timeMs, 30_250);
});

test('a paused run never advances', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies({ getcurrenttimerphase: 'Paused' }));
  const run = tracker(channel);
  await run.poll();

  clock += 250;
  const snapshot = await run.poll();

  assert.equal(snapshot.advancing, false);
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

  assert.equal(snapshot.lastBestSegmentMs, null);
});

/** The segment on screen is the one just finished, not the one being run. */
test('a completed split reports its own segment and record', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({
      getsplitindex: '0',
      getlastsplittime: '-',
      'getcomparisonsplittime Best Segments': '00:00:18.00',
    }),
  );
  const run = tracker(channel);
  const started = await run.poll();

  assert.equal(started.lastSegmentMs, null); // nothing finished yet
  assert.equal(started.lastBestSegmentMs, null);

  clock += 250;
  channel.set(
    runningReplies({
      getsplitindex: '1',
      getlastsplittime: '00:00:16.00',
      'getcomparisonsplittime Best Segments': '00:00:40.00',
    }),
  );
  const split = await run.poll();

  assert.equal(split.lastSegmentMs, 16_000);
  assert.equal(split.lastBestSegmentMs, 18_000);
});

test('the first split of a run compares against the start', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({
      getsplitindex: '0',
      getlastsplittime: '-',
      'getcomparisonsplittime Best Segments': '00:00:18.00',
    }),
  );
  const snapshot = await tracker(channel).poll();

  assert.equal(snapshot.timeMs, 30_000);
  assert.equal(snapshot.splitIndex, 0);
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

test('a command the server lacks is detected once and then skipped', async () => {
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

test('without getsplitcount the run has no rows', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies({ getsplitcount: null }));
  const snapshot = await tracker(channel).poll();

  assert.deepEqual(snapshot.splits, []);
  assert.equal(channel.sent.includes('getsplitname 1'), false);
});

/** Times are indexed, so rows still make sense on a server without names. */
test('without getsplitname the rows are kept but unnamed', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({
      'getsplitname 0': null,
      'getsplitname 1': null,
      'getsplitname 2': null,
    }),
  );
  const snapshot = await tracker(channel).poll();

  assert.equal(snapshot.splits.length, 3);
  assert.deepEqual(
    snapshot.splits.map((split) => split.name),
    ['', '', ''],
  );
});

test('an error reply is not shown as data', async () => {
  clock = 0;
  const channel = new FakeChannel(
    runningReplies({
      getcurrentsplitname: '[Error]: System.Exception: Unrecognized command',
      getdelta: '[Error]: System.Collections.Generic.KeyNotFoundException',
    }),
  );
  const snapshot = await tracker(channel).poll();

  assert.equal(snapshot.splitName, '');
  assert.equal(snapshot.lastDeltaMs, null);
});

test('an optional command that kills the connection is retired', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  channel.set(
    runningReplies({
      getsplitindex: '2',
      'getcomparisonsplittime Best Segments': null,
    }),
  );
  await assert.rejects(run.poll(), /timeout/i);

  channel.set(runningReplies({ 'getcomparisonsplittime Best Segments': null }));
  const marker = channel.sent.length;
  const snapshot = await run.poll();

  assert.equal(
    channel.since(marker).includes('getcomparisonsplittime Best Segments'),
    false,
  );
  assert.equal(snapshot.lastBestSegmentMs, null);
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
  assert.equal(snapshot.lastSegmentMs, null);
  assert.equal(snapshot.splitName, '');
});

test('reset() reloads the run but keeps the detected features', async () => {
  clock = 0;
  const channel = new FakeChannel(runningReplies());
  const run = tracker(channel);
  await run.poll();

  run.reset();
  const marker = channel.sent.length;
  const probedBefore = channel.probed.length;
  await run.poll();

  assert.ok(channel.since(marker).includes('getsplitname 1'));
  assert.equal(channel.probed.length, probedBefore);
});
