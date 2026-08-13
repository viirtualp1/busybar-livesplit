import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { after, test } from 'node:test';
import { LiveSplitConnection } from '../src/livesplit/connection.js';

type Reply = string | null;
type Handler = (command: string) => Reply;

type FakeServer = {
  port: number;
  close: () => Promise<void>;
  received: string[];
};

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
        if (reply !== null) {
          socket.write(`${reply}\r\n`);
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

test('connects over tcp and answers commands in order', async () => {
  const server = await startServer(standard);
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp');

  await connection.connect();
  assert.equal(connection.activeProtocol, 'tcp');
  assert.equal(await connection.send('getcurrenttime'), '00:01:02.50');
  assert.equal(await connection.send('getcurrenttimerphase'), 'Running');

  connection.disconnect();
  await server.close();
});

test('probe reports a supported command without losing sync', async () => {
  const server = await startServer(standard);
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp');
  await connection.connect();

  assert.equal(await connection.probe('getattemptcount'), '42');
  // The following reply must still belong to the following command.
  assert.equal(await connection.send('getcurrenttime'), '00:01:02.50');

  connection.disconnect();
  await server.close();
});

test('probe reports an unsupported command without losing sync', async () => {
  const server = await startServer(standard);
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp');
  await connection.connect();

  assert.equal(await connection.probe('getsplitcount'), null);
  assert.equal(await connection.send('getcurrenttime'), '00:01:02.50');
  assert.equal(await connection.send('getcurrenttimerphase'), 'Running');

  connection.disconnect();
  await server.close();
});

test('a silent command drops the connection instead of shifting later replies', async () => {
  const server = await startServer((command) =>
    command === 'getcurrenttimerphase' ? 'Running' : null,
  );
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp');
  await connection.connect();

  await assert.rejects(connection.send('getcurrenttime'), /timeout/i);
  assert.equal(connection.connected, false);
  await assert.rejects(connection.send('getcurrenttime'), /not connected/i);

  await server.close();
});

test('a closed socket rejects pending commands', async () => {
  const server = await startServer(standard);
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp');
  await connection.connect();

  const pending = connection.send('getunknown');
  connection.disconnect('bye');

  await assert.rejects(pending, /bye/);
  assert.equal(connection.connected, false);
  await server.close();
});

test('a wrong handshake is reported instead of accepted', async () => {
  const server = await startServer(() => 'not-a-phase');
  const connection = new LiveSplitConnection('127.0.0.1', server.port, 'tcp');

  await assert.rejects(connection.connect(), /handshake/i);
  assert.equal(connection.connected, false);
  await server.close();
});

test('a refused port surfaces the connection error', async () => {
  const server = await startServer(standard);
  const port = server.port;
  await server.close();

  const connection = new LiveSplitConnection('127.0.0.1', port, 'tcp');
  await assert.rejects(connection.connect());
  assert.equal(connection.connected, false);
});
