import { Socket } from 'node:net';

export type TimerPhase = 'NotRunning' | 'Running' | 'Paused' | 'Ended';
export type LiveSplitProtocol = 'auto' | 'tcp' | 'ws';

export type LiveSplitState = {
  phase: TimerPhase;
  timeMs: number;
  lastDeltaMs: number | null;
  liveDeltaMs: number | null;
  splitName: string;
  splitIndex: number;
};

type Pending = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

const PHASES = new Set<TimerPhase>(['NotRunning', 'Running', 'Paused', 'Ended']);
const COMMAND_TIMEOUT_MS = 1500;

export class LiveSplitClient {
  private socket: Socket | null = null;
  private ws: WebSocket | null = null;
  private buffer = '';
  private pending: Pending[] = [];
  private connecting: Promise<void> | null = null;
  private protocol: Exclude<LiveSplitProtocol, 'auto'> | null = null;

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

  get activeProtocol(): string | null {
    return this.protocol;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connectInternal().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
    this.ws?.close();
    this.ws = null;
    this.protocol = null;
    this.failPending(new Error('LiveSplit disconnected'));
  }

  async getState(): Promise<LiveSplitState> {
    const phaseRaw = await this.send('getcurrenttimerphase');
    const phase = PHASES.has(phaseRaw as TimerPhase)
      ? (phaseRaw as TimerPhase)
      : 'NotRunning';

    const timeMs = parseLiveSplitTime(await this.send('getcurrenttime')) ?? 0;
    const splitIndex = Number.parseInt(await this.send('getsplitindex'), 10);
    const index = Number.isFinite(splitIndex) ? splitIndex : -1;

    let lastDeltaMs: number | null = null;
    let liveDeltaMs: number | null = null;
    let splitName = '';

    if (phase === 'Running' || phase === 'Paused') {
      lastDeltaMs = parseLiveSplitTime(await this.send('getdelta'));
      const comparisonMs = parseLiveSplitTime(
        await this.send('getcomparisonsplittime'),
      );
      if (comparisonMs !== null) {
        liveDeltaMs = timeMs - comparisonMs;
      }
      splitName = sanitizeSplitName(await this.send('getcurrentsplitname'));
    } else if (phase === 'Ended') {
      lastDeltaMs = parseLiveSplitTime(await this.send('getdelta'));
      liveDeltaMs = lastDeltaMs;
      splitName = sanitizeSplitName(await this.send('getprevioussplitname'));
    }

    return {
      phase,
      timeMs,
      lastDeltaMs,
      liveDeltaMs,
      splitName,
      splitIndex: index,
    };
  }

  private async connectInternal(): Promise<void> {
    const order: Array<'tcp' | 'ws'> =
      this.preferred === 'ws'
        ? ['ws']
        : this.preferred === 'tcp'
          ? ['tcp']
          : ['tcp', 'ws'];

    let lastError: Error | null = null;
    for (const protocol of order) {
      try {
        this.cleanupTransport();
        if (protocol === 'tcp') {
          await this.connectTcp();
        } else {
          await this.connectWs();
        }
        this.protocol = protocol;
        const phase = await this.send('getcurrenttimerphase');
        if (!PHASES.has(phase as TimerPhase)) {
          throw new Error(`Unexpected LiveSplit handshake (${protocol}): ${phase}`);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.cleanupTransport();
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

      const onError = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      socket.once('error', onError);
      socket.connect(this.port, this.host, () => {
        socket.off('error', onError);
        this.socket = socket;
        resolve();
      });

      socket.on('data', (chunk: string) => {
        this.buffer += chunk;
        this.flushBuffer();
      });

      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = null;
          this.protocol = null;
          this.failPending(new Error('LiveSplit connection closed'));
        }
      });

      socket.on('error', (error) => {
        this.failPending(error);
      });
    });
  }

  private connectWs(): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(new Error('WebSocket is not available in this Node version'));
    }

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.host}:${this.port}/livesplit`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('LiveSplit WebSocket timeout'));
      }, 3000);

      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        resolve();
      });

      ws.addEventListener('message', (event) => {
        this.pending.shift()?.resolve(String(event.data).replace(/[\r\n]+$/, ''));
      });

      ws.addEventListener('close', () => {
        if (this.ws === ws) {
          this.ws = null;
          this.protocol = null;
          this.failPending(new Error('LiveSplit connection closed'));
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        if (this.ws !== ws) {
          reject(new Error('LiveSplit WebSocket error'));
        } else {
          this.failPending(new Error('LiveSplit WebSocket error'));
        }
      });
    });
  }

  private send(command: string): Promise<string> {
    if (!this.connected) {
      return Promise.reject(new Error('LiveSplit is not connected'));
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.pending.indexOf(wrapped);
        if (index !== -1) {
          this.pending.splice(index, 1);
        }
        reject(new Error(`LiveSplit timeout: ${command}`));
      }, COMMAND_TIMEOUT_MS);

      const wrapped: Pending = {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };

      this.pending.push(wrapped);

      if (this.protocol === 'ws') {
        this.ws?.send(command);
      } else {
        this.socket?.write(`${command}\n`);
      }
    });
  }

  private flushBuffer(): void {
    while (true) {
      const match = this.buffer.match(/\r\n|\n|\r/);
      if (!match || match.index === undefined) {
        break;
      }
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.pending.shift()?.resolve(line);
    }
  }

  private cleanupTransport(): void {
    this.failPending(new Error('LiveSplit switching protocol'));
    this.socket?.destroy();
    this.socket = null;
    this.ws?.close();
    this.ws = null;
    this.protocol = null;
    this.buffer = '';
  }

  private failPending(error: Error): void {
    const pending = this.pending.splice(0);
    this.buffer = '';
    for (const item of pending) {
      item.reject(error);
    }
  }
}

export function parseLiveSplitTime(raw: string): number | null {
  const value = raw.trim();
  if (!value || value === '-' || value === '?') {
    return null;
  }

  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const parts = body.split(':');

  let ms = 0;
  if (parts.length === 3) {
    ms =
      Number(parts[0]) * 3_600_000 +
      Number(parts[1]) * 60_000 +
      Number.parseFloat(parts[2] ?? '') * 1000;
  } else if (parts.length === 2) {
    ms = Number(parts[0]) * 60_000 + Number.parseFloat(parts[1] ?? '') * 1000;
  } else {
    ms = Number.parseFloat(parts[0] ?? '') * 1000;
  }

  if (!Number.isFinite(ms)) {
    return null;
  }

  return negative ? -ms : ms;
}

function sanitizeSplitName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ');
  if (!cleaned || cleaned === '-') {
    return '';
  }
  return cleaned;
}
