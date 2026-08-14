import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { after, test } from 'node:test';
import { LiveSplitConnection, type Timeouts } from '../src/livesplit/connection.js';
import { RunTracker } from '../src/livesplit/tracker.js';
import { buildFrame } from '../src/view/frame.js';

const FAST: Timeouts = { responseMs: 200, optionalMs: 80 };

const SPLITS = ['One', 'Two', 'Three'];
const PB = ['00:00:15.00', '00:00:35.00', '00:00:55.00'];
const BEST = ['00:00:14.00', '00:00:32.00', '00:00:50.00'];

const servers: Server[] = [];

after(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/** Mirrors LiveSplit's built-in server: known commands answer, the rest stay silent. */
function modernServer(command: string): string | null {
  const [name, argument = ''] = split(command);
  switch (name) {
    case 'getcurrenttimerphase':
      return 'Running';
    case 'getcurrenttime':
      return '00:00:30.00';
    case 'getsplitindex':
      return '1';
    case 'getsplitcount':
      return String(SPLITS.length);
    case 'getsplitname':
      return SPLITS[Number(argument)] ?? '-';
    case 'getattemptcount':
      return '12';
    case 'getdelta':
      return '-00:00:02.00';
    case 'getlastsplittime':
      return '00:00:20.00';
    case 'getcomparisonsplittime':
      return argument === 'Best Segments' ? (BEST[1] ?? '-') : (PB[1] ?? '-');
    case 'getcurrentsplitname':
      return 'Two';
    case 'getprevioussplitname':
      return 'One';
    default:
      return null;
  }
}

/** The deprecated component instead answers unknown commands with an error line. */
function legacyServer(command: string): string | null {
  const [name] = split(command);
  if (name === 'getsplitcount' || name === 'getsplitname' || name === 'getattemptcount') {
    return `[Error]: System.Exception: Unrecognized command: "${name}"`;
  }
  return modernServer(command);
}

function split(command: string): [string, string?] {
  const at = command.indexOf(' ');
  if (at === -1) {
    return [command];
  }
  return [command.slice(0, at), command.slice(at + 1)];
}

async function startServer(handler: (command: string) => string | null): Promise<number> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const command = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (command) {
          const reply = handler(command);
          if (reply !== null) {
            socket.write(`${reply}\n`);
          }
        }
      }
    });
    socket.on('error', () => {
      // the client tears connections down on purpose
    });
  });
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

test('a modern server drives a full frame over a real socket', async () => {
  const port = await startServer(modernServer);
  const connection = new LiveSplitConnection('127.0.0.1', port, 'tcp', FAST);
  const tracker = new RunTracker(connection, { now: () => 0 });

  try {
    await connection.connect();
    const snapshot = await tracker.poll();

    assert.equal(snapshot.phase, 'Running');
    assert.equal(snapshot.timeMs, 30_000);
    assert.equal(snapshot.splitIndex, 1);
    assert.equal(snapshot.splitName, 'Two');
    assert.equal(snapshot.attemptCount, 12);
    assert.deepEqual(
      snapshot.splits.map((entry) => entry.name),
      SPLITS,
    );
    assert.equal(snapshot.lastBestSegmentMs, null); // split 0 was never polled

    const frame = buildFrame(snapshot, { nowMs: 0, maxRows: 3 });
    assert.equal(frame.timeText, '0:30.00');
    assert.equal(frame.splitText, 'Two');
    assert.equal(frame.backRows.length, 3);
    assert.equal(frame.backRows[1]?.current, true);

    // A second poll must still line up, which is what a shifted reply would break.
    const again = await tracker.poll();
    assert.equal(again.phase, 'Running');
    assert.equal(connection.connected, true);
  } finally {
    connection.disconnect();
  }
});

test('a legacy server keeps the timer working without the optional commands', async () => {
  const port = await startServer(legacyServer);
  const connection = new LiveSplitConnection('127.0.0.1', port, 'tcp', FAST);
  const tracker = new RunTracker(connection, { now: () => 0 });

  try {
    await connection.connect();
    const snapshot = await tracker.poll();

    assert.equal(snapshot.phase, 'Running');
    assert.equal(snapshot.timeMs, 30_000);
    assert.equal(snapshot.splitName, 'Two');
    assert.equal(snapshot.attemptCount, 0);
    assert.deepEqual(
      snapshot.splits.map((entry) => entry.name),
      ['One', 'Two'],
    );

    const frame = buildFrame(snapshot, { nowMs: 0, maxRows: 3 });
    assert.equal(frame.timeText, '0:30.00');
    assert.equal(frame.splitText, 'Two');
    assert.equal(frame.backRows.length, 2);

    const again = await tracker.poll();
    assert.equal(again.phase, 'Running');
    assert.equal(connection.connected, true);
  } finally {
    connection.disconnect();
  }
});
