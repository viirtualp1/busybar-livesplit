import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeTextFile, parseSplitsFile } from '../src/livesplit/splits-file.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Run version="1.7.0">
  <GameName>Game</GameName>
  <CategoryName>Any%</CategoryName>
  <AttemptCount>12</AttemptCount>
  <Segments>
    <Segment>
      <Name>One</Name>
      <SplitTimes>
        <SplitTime name="Personal Best">
          <RealTime>00:00:15.0000000</RealTime>
        </SplitTime>
      </SplitTimes>
      <BestSegmentTime>
        <RealTime>00:00:14.0000000</RealTime>
      </BestSegmentTime>
    </Segment>
    <Segment>
      <Name>Two</Name>
      <SplitTimes>
        <SplitTime name="Personal Best" />
      </SplitTimes>
      <BestSegmentTime />
    </Segment>
  </Segments>
</Run>
`;

test('a splits file yields names, pb and best segments', () => {
  const run = parseSplitsFile(SAMPLE, 'real', 'C:\\runs\\game.lss');
  assert.ok(run);
  assert.equal(run.gameName, 'Game');
  assert.equal(run.categoryName, 'Any%');
  assert.equal(run.attemptCount, 12);
  assert.deepEqual(
    run.segments.map((segment) => segment.name),
    ['One', 'Two'],
  );
  assert.equal(run.segments[0]?.pbMs, 15_000);
  assert.equal(run.segments[0]?.bestSegmentMs, 14_000);
  assert.equal(run.segments[1]?.pbMs, null);
});

test('utf-16 settings are readable', () => {
  const xml = '<?xml version="1.0"?><Settings/>';
  const utf16 = Buffer.from(`\uFEFF${xml}`, 'utf16le');
  assert.equal(decodeTextFile(utf16).replace(/^\uFEFF/, ''), xml);
});
