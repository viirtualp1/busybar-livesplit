import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { after, test } from 'node:test';
import { LiveSplitConnection, type Timeouts } from '../src/livesplit/connection.js';

type Reply = string | null | { line: string; delayMs: number };
type Handler = (command: string) => Reply;

type FakeServer = {
  port: number;
  close: () => Promise<void>;
  received: string[];
  push: (line: string) => void;
};

const FAST: Timeouts = { responseMs: 150, optionalMs: 80 };

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

async function startServer(handler: Handler): Promise<FakeServer> {
  const received: string[] = [];
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
        if (!command) {
          continue;
        }
        received.push(command);
        const reply = handler(command);
        if (typeof reply === 'string') {
          socket.write(`${reply}\r\n`);
        } else if (reply !== null) {
          setTimeout(() => socket.write(`${reply.line}\r\n`), reply.delayMs);
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
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    received,
    push: (line) => {
      for (const socket of sockets) {
        socket.write(`${line}\r\n`);
      }
    },
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

const standard: Handler = (command) => {
  if (command === 'getcurrenttimerphase') {
    return 'Running';
  }
  if (command === 'getcurrenttime') {
    return '00:01:02.50';
  }
  if (command === 'getattemptcount') {
    return '42';
  }
  return null;
};

async function connect(server: FakeServer): Promise<LiveSplitConnection> {
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp', FAST);
  await connection.connect();
  return connection;
}

test('connects over tcp and answers commands in order', async () => {
  const server = await startServer(standard);
  const connection = await connect(server);

  assert.equal(connection.activeProtocol, 'tcp');
  assert.equal(await connection.send('getcurrenttime'), '00:01:02.50');
  assert.equal(await connection.send('getcurrenttimerphase'), 'Running');

  connection.disconnect();
  await server.close();
});

test('trySend returns the reply of a known command and keeps sync', async () => {
  const server = await startServer(standard);
  const connection = await connect(server);

  assert.equal(await connection.trySend('getattemptcount'), '42');
  assert.equal(await connection.send('getcurrenttime'), '00:01:02.50');

  connection.disconnect();
  await server.close();
});

/** The reply to a phase-answering command must not be read as the barrier's. */
test('trySend does not report a phase command as missing', async () => {
  const server = await startServer(standard);
  const connection = await connect(server);

  assert.equal(await connection.trySend('getcurrenttimerphase'), 'Running');
  assert.equal(await connection.send('getcurrenttime'), '00:01:02.50');

  connection.disconnect();
  await server.close();
});

test('trySend reports a silent command as missing and keeps sync', async () => {
  const server = await startServer(standard);
  const connection = await connect(server);

  assert.equal(await connection.trySend('getsplitcount'), null);
  assert.equal(await connection.send('getcurrenttime'), '00:01:02.50');
  assert.equal(await connection.send('getcurrenttimerphase'), 'Running');

  connection.disconnect();
  await server.close();
});

/** A slow barrier lets the late reply land in its slot, which is the dangerous case. */
test('a reply arriving after the probe gave up is caught as a desync', async () => {
  let phaseCalls = 0;
  const server = await startServer((command) => {
    if (command !== 'getcurrenttimerphase') {
      return null;
    }
    phaseCalls += 1;
    return phaseCalls === 1 ? 'Running' : { line: 'Running', delayMs: 120 };
  });
  const connection = await connect(server);

  const probe = connection.trySend('getsplitcount');
  setTimeout(() => server.push('12'), FAST.optionalMs + 15);

  await assert.rejects(probe, /out of sync/i);
  assert.equal(connection.connected, false);
  await server.close();
});

test('an unsolicited reply drops the connection', async () => {
  const server = await startServer(standard);
  const connection = await connect(server);

  server.push('surprise');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(connection.connected, false);
  await server.close();
});

test('a silent command drops the connection instead of shifting later replies', async () => {
  const server = await startServer((command) =>
    command === 'getcurrenttimerphase' ? 'Running' : null,
  );
  const connection = await connect(server);

  await assert.rejects(connection.send('getcurrenttime'), /timeout/i);
  assert.equal(connection.connected, false);
  await assert.rejects(connection.send('getcurrenttime'), /not connected/i);

  await server.close();
});

test('a closed socket rejects pending commands', async () => {
  const server = await startServer(standard);
  const connection = await connect(server);

  const pending = connection.send('getunknown');
  connection.disconnect('bye');

  await assert.rejects(pending, /bye/);
  assert.equal(connection.connected, false);
  await server.close();
});

test('a wrong handshake is reported instead of accepted', async () => {
  const server = await startServer(() => 'not-a-phase');
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp', FAST);

  await assert.rejects(connection.connect(), /handshake/i);
  assert.equal(connection.connected, false);
  await server.close();
});

test('a refused port surfaces the connection error', async () => {
  const server = await startServer(standard);
  const port = server.port;
  await server.close();

  const connection = new LiveSplitConnection('127.0.0.1', port, 'tcp', FAST);
  await assert.rejects(connection.connect());
  assert.equal(connection.connected, false);
});
