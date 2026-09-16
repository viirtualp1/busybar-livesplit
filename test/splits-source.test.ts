import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseRecentSplits, SplitsCatalog } from '../src/livesplit/splits-source.js';

const SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<Settings version="1.8.18">
  <RecentSplits>
    <SplitsFile gameName="Old" categoryName="100%" lastTimingMethod="RealTime">C:\\missing\\old.lss</SplitsFile>
    <SplitsFile gameName="Game" categoryName="Any%" lastTimingMethod="GameTime">__PATH__</SplitsFile>
  </RecentSplits>
</Settings>
`;

const LSS = `<?xml version="1.0" encoding="UTF-8"?>
<Run version="1.7.0">
  <GameName>Game</GameName>
  <CategoryName>Any%</CategoryName>
  <AttemptCount>4</AttemptCount>
  <Segments>
    <Segment>
      <Name>Cave</Name>
      <SplitTimes>
        <SplitTime name="Personal Best">
          <GameTime>00:01:00.0000000</GameTime>
          <RealTime>00:01:10.0000000</RealTime>
        </SplitTime>
      </SplitTimes>
      <BestSegmentTime>
        <GameTime>00:00:55.0000000</GameTime>
      </BestSegmentTime>
    </Segment>
    <Segment>
      <Name>Boss</Name>
      <SplitTimes>
        <SplitTime name="Personal Best">
          <GameTime>00:02:00.0000000</GameTime>
        </SplitTime>
      </SplitTimes>
      <BestSegmentTime />
    </Segment>
  </Segments>
</Run>
`;

test('the last RecentSplits entry is tried first', () => {
  const found = parseRecentSplits(SETTINGS.replace('__PATH__', 'C:\\runs\\game.lss'));
  assert.equal(found[0]?.path, 'C:\\runs\\game.lss');
  assert.equal(found[0]?.timingMethod, 'game');
  assert.equal(found[1]?.path, 'C:\\missing\\old.lss');
  assert.equal(found[1]?.timingMethod, 'real');
});

test('the catalog loads the current run from LiveSplit settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'busybar-splits-'));
  const splitsPath = join(dir, 'game.lss');
  await writeFile(splitsPath, LSS);
  await writeFile(join(dir, 'settings.cfg'), SETTINGS.replace('__PATH__', splitsPath));

  const catalog = new SplitsCatalog('', {
    logger: { info() {}, warn() {} },
    locateDir: async () => dir,
  });
  await catalog.ready();

  const run = catalog.runs()[0];
  assert.ok(run);
  assert.equal(run.gameName, 'Game');
  assert.deepEqual(
    run.segments.map((segment) => segment.name),
    ['Cave', 'Boss'],
  );
  assert.equal(run.segments[0]?.pbMs, 60_000);
});

test('a closed LiveSplit is looked for once a minute, not on every recheck', async () => {
  let clock = 0;
  let lookups = 0;
  const catalog = new SplitsCatalog('', {
    logger: { info() {}, warn() {} },
    now: () => clock,
    locateDir: () => {
      lookups += 1;

      return Promise.resolve(null);
    },
  });
  await catalog.ready();

  for (const at of [6000, 12_000, 30_000, 59_000]) {
    clock = at;
    await catalog.ready();
  }
  assert.equal(lookups, 1, 'each look is a PowerShell process');

  // Past both the minute and the five-second recheck after 59s.
  clock = 65_000;
  await catalog.ready();
  assert.equal(lookups, 2, 'but it is still found once it starts');
});

test('a nearby lss file is used when RecentSplits is empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'busybar-splits-'));
  await writeFile(join(dir, 'solo.lss'), LSS);
  await writeFile(join(dir, 'settings.cfg'), '<Settings><RecentSplits /></Settings>');

  const catalog = new SplitsCatalog('', {
    logger: { info() {}, warn() {} },
    locateDir: async () => dir,
  });
  await catalog.ready();

  assert.equal(catalog.runs()[0]?.segments.length, 2);
});
