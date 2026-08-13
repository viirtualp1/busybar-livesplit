import { Socket } from 'node:net';
import { isTimerPhase, type LiveSplitProtocol } from './types.js';

/** Answers with one of four known phases, so its reply is never mistaken for another command's. */
const MARKER = 'getcurrenttimerphase';

const RESPONSE_TIMEOUT_MS = 1500;
const WS_CONNECT_TIMEOUT_MS = 3000;

type Waiter = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
};

/**
 * Line protocol over TCP or WebSocket. Replies carry no request id, so they are
 * matched by arrival order — which means a late reply would shift every following
 * one. Any timeout therefore tears the connection down instead of skipping a slot.
 */
export class LiveSplitConnection {
  private socket: Socket | null = null;
  private ws: WebSocket | null = null;
  private protocol: 'tcp' | 'ws' | null = null;
  private buffer = '';
  private waiters: Waiter[] = [];
  private inbox: string[] = [];
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly preferred: LiveSplitProtocol = 'auto',
  ) {}

  get connected(): boolean {
    if (this.protocol === 'tcp') {
      return this.socket?.readyState === 'open';
    }
    if (this.protocol === 'ws') {
      return this.ws?.readyState === WebSocket.OPEN;
    }
    return false;
  }

  get activeProtocol(): 'tcp' | 'ws' | null {
    return this.protocol;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.connecting ??= this.connectInternal().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  disconnect(reason = 'LiveSplit disconnected'): void {
    this.teardown(new Error(reason));
  }

  async send(command: string): Promise<string> {
    this.write(command);
    return this.expect(command);
  }

  /**
   * Unknown commands get no reply at all, so a marker is queued behind the probe:
   * one reply means only the marker answered, two means the probe is supported.
   */
  async probe(command: string): Promise<string | null> {
    this.write(command);
    this.write(MARKER);
    const first = await this.expect(command);
    if (isTimerPhase(first)) {
      return null;
    }
    await this.expect(MARKER);
    return first;
  }

  private async connectInternal(): Promise<void> {
    const order: Array<'tcp' | 'ws'> =
      this.preferred === 'auto' ? ['tcp', 'ws'] : [this.preferred];

    let lastError: Error | null = null;
    for (const protocol of order) {
      try {
        this.teardown(new Error('LiveSplit switching protocol'));
        if (protocol === 'tcp') {
          await this.connectTcp();
        } else {
          await this.connectWs();
        }
        this.protocol = protocol;

        const phase = await this.send(MARKER);
        if (!isTimerPhase(phase)) {
          throw new Error(`Unexpected LiveSplit handshake (${protocol}): ${phase}`);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.teardown(lastError);
      }
    }

    throw lastError ?? new Error('Failed to connect to LiveSplit');
  }

  private connectTcp(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      socket.setEncoding('utf8');
      socket.setKeepAlive(true, 1000);
      socket.setNoDelay(true);

      const onConnectError = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      socket.once('error', onConnectError);
      socket.connect(this.port, this.host, () => {
        socket.off('error', onConnectError);
        socket.on('error', (error) => {
          if (this.socket === socket) {
            this.teardown(error);
          }
        });
        this.socket = socket;
        resolve();
      });

      socket.on('data', (chunk: string) => {
        this.buffer += chunk;
        this.flushBuffer();
      });

      socket.on('close', () => {
        if (this.socket === socket) {
          this.teardown(new Error('LiveSplit connection closed'));
        }
      });
    });
  }

  private connectWs(): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(new Error('WebSocket is not available in this Node version'));
    }

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.host}:${this.port}/livesplit`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('LiveSplit WebSocket timeout'));
      }, WS_CONNECT_TIMEOUT_MS);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });

      ws.addEventListener('message', (event) => {
        this.resolveNext(String(event.data).replace(/[\r\n]+$/, ''));
      });

      ws.addEventListener('close', () => {
        if (this.ws === ws) {
          this.teardown(new Error('LiveSplit connection closed'));
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        if (this.ws === ws) {
          this.teardown(new Error('LiveSplit WebSocket error'));
        } else {
          reject(new Error('LiveSplit WebSocket error'));
        }
      });
    });
  }

  private write(command: string): void {
    if (!this.connected) {
      throw new Error(`LiveSplit is not connected (${command})`);
    }
    if (this.protocol === 'ws') {
      this.ws?.send(command);
      return;
    }
    this.socket?.write(`${command}\n`);
  }

  private expect(command: string): Promise<string> {
    const buffered = this.inbox.shift();
    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.teardown(new Error(`LiveSplit timeout: ${command}`));
      }, RESPONSE_TIMEOUT_MS);

      this.waiters.push({
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  private flushBuffer(): void {
    while (true) {
      const match = this.buffer.match(/\r\n|\n|\r/);
      if (!match || match.index === undefined) {
        return;
      }
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.resolveNext(line);
    }
  }

  /** Both replies can arrive in one chunk, before the second waiter is registered. */
  private resolveNext(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(line);
      return;
    }
    this.inbox.push(line);
  }

  private teardown(error: Error): void {
    const socket = this.socket;
    const ws = this.ws;
    this.socket = null;
    this.ws = null;
    this.protocol = null;
    this.buffer = '';
    this.inbox = [];

    socket?.destroy();
    ws?.close();

    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}
