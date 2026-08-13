import { Socket } from 'node:net';
import { isTimerPhase, type LiveSplitProtocol } from './types.js';

/** Answers with one of four known phases, so a stale reply is easy to spot. */
const BARRIER = 'getcurrenttimerphase';

const WS_CONNECT_TIMEOUT_MS = 3000;

export type Timeouts = {
  /** A required command has no reason to be slow; missing its reply is fatal. */
  responseMs: number;
  /** Long enough that a slow answer is not mistaken for an unknown command. */
  optionalMs: number;
};

export const DEFAULT_TIMEOUTS: Timeouts = {
  responseMs: 3000,
  optionalMs: 2000,
};

type Waiter = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
};

/** Carries the command so a caller can retire the feature that timed out. */
export class LiveSplitTimeoutError extends Error {
  constructor(readonly command: string) {
    super(`LiveSplit timeout: ${command}`);
    this.name = 'LiveSplitTimeoutError';
  }
}

/** A reply arrived out of turn, so request and response are no longer paired. */
export class LiveSplitDesyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveSplitDesyncError';
  }
}

/**
 * Line protocol over TCP or WebSocket. Replies carry no request id, so they are
 * matched by arrival order: exactly one command is in flight at a time, and a
 * reply nobody asked for means the stream has shifted and is torn down.
 */
export class LiveSplitConnection {
  private socket: Socket | null = null;
  private ws: WebSocket | null = null;
  private protocol: 'tcp' | 'ws' | null = null;
  private buffer = '';
  private waiters: Waiter[] = [];
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly preferred: LiveSplitProtocol = 'auto',
    private readonly timeouts: Timeouts = DEFAULT_TIMEOUTS,
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
    return new Promise<string>((resolve, reject) => {
      this.enqueue(resolve, reject, this.timeouts.responseMs, () => {
        this.teardown(new LiveSplitTimeoutError(command));
      });
    });
  }

  /**
   * For commands older LiveSplit builds do not know: those stay silent instead
   * of answering, so a miss is a normal outcome. A late reply would land on the
   * next command, so the phase barrier confirms the stream is still aligned
   * before the caller sends anything else.
   */
  async trySend(command: string): Promise<string | null> {
    this.write(command);
    const reply = await new Promise<string | null>((resolve, reject) => {
      this.enqueue(resolve, reject, this.timeouts.optionalMs, (waiter) => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        resolve(null);
      });
    });

    const phase = await this.send(BARRIER);
    if (!isTimerPhase(phase)) {
      const error = new LiveSplitDesyncError(
        `LiveSplit out of sync after "${command}": ${phase}`,
      );
      this.teardown(error);
      throw error;
    }
    return reply;
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

        const phase = await this.send(BARRIER);
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

  private enqueue(
    resolve: (line: string) => void,
    reject: (error: Error) => void,
    timeoutMs: number,
    onTimeout: (waiter: Waiter) => void,
  ): void {
    const waiter: Waiter = {
      resolve: (line) => {
        clearTimeout(timer);
        resolve(line);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    const timer = setTimeout(() => onTimeout(waiter), timeoutMs);
    this.waiters.push(waiter);
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

  private resolveNext(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(line);
      return;
    }
    this.teardown(new LiveSplitDesyncError(`Unexpected LiveSplit reply: ${line}`));
  }

  private teardown(error: Error): void {
    const socket = this.socket;
    const ws = this.ws;
    this.socket = null;
    this.ws = null;
    this.protocol = null;
    this.buffer = '';

    socket?.destroy();
    ws?.close();

    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}
