import { Socket } from 'node:net';

export type TimerPhase = 'NotRunning' | 'Running' | 'Paused' | 'Ended';

export type LiveSplitState = {
  phase: TimerPhase;
  timeMs: number;
  deltaMs: number | null;
  splitName: string;
  splitIndex: number;
};

type Pending = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

const PHASES = new Set<TimerPhase>(['NotRunning', 'Running', 'Paused', 'Ended']);

export class LiveSplitClient {
  private socket: Socket | null = null;
  private buffer = '';
  private pending: Pending[] = [];
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === 'open';
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      socket.setEncoding('utf8');
      socket.setKeepAlive(true, 1000);
      socket.setNoDelay(true);

      const onError = (error: Error) => {
        socket.destroy();
        this.failPending(error);
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
        this.socket = null;
        this.failPending(new Error('LiveSplit connection closed'));
      });

      socket.on('error', (error) => {
        this.failPending(error);
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
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

    let deltaMs: number | null = null;
    let splitName = '';
    if (phase !== 'NotRunning') {
      deltaMs = parseLiveSplitTime(await this.send('getdelta'));
    }
    if (phase === 'Running' || phase === 'Paused') {
      splitName = sanitizeSplitName(await this.send('getcurrentsplitname'));
    } else if (phase === 'Ended') {
      splitName = sanitizeSplitName(await this.send('getprevioussplitname'));
    }

    return {
      phase,
      timeMs,
      deltaMs,
      splitName,
      splitIndex: index,
    };
  }

  private send(command: string): Promise<string> {
    const socket = this.socket;
    if (!socket || !this.connected) {
      return Promise.reject(new Error('LiveSplit is not connected'));
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.pending.findIndex((item) => item.resolve === wrapped.resolve);
        if (index !== -1) {
          this.pending.splice(index, 1);
        }
        reject(new Error(`LiveSplit timeout: ${command}`));
      }, 1000);

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
      socket.write(`${command}\r\n`);
    });
  }

  private flushBuffer(): void {
    while (true) {
      const idx = this.buffer.indexOf('\r\n');
      if (idx === -1) {
        break;
      }
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.pending.shift()?.resolve(line);
    }
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
