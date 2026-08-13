import { Socket } from 'node:net';

export type TimerPhase = 'NotRunning' | 'Running' | 'Paused' | 'Ended';
export type LiveSplitProtocol = 'auto' | 'tcp' | 'ws';

export type SplitInfo = {
  name: string;
  pbMs: number | null;
  runMs: number | null;
};

export type LiveSplitState = {
  phase: TimerPhase;
  timeMs: number;
  lastDeltaMs: number | null;
  liveDeltaMs: number | null;
  liveSegmentMs: number | null;
  bestSegmentMs: number | null;
  isGold: boolean;
  splitName: string;
  splitIndex: number;
  splitCount: number;
  attemptCount: number;
  splits: SplitInfo[];
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
  private splitNames: string[] = [];
  private pbByIndex: Array<number | null> = [];
  private runByIndex: Array<number | null> = [];
  private bsByIndex: Array<number | null> = [];
  private lastAttemptCount = 0;
  private supportsBestSegments = true;
  private supportsAttemptCount = true;
  private supportsSplitCount = true;
  private splitNamesProbed = false;
  private chain: Promise<void> = Promise.resolve();

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

  reset(): Promise<void> {
    return this.control('reset');
  }

  pause(): Promise<void> {
    return this.control('pause');
  }

  resume(): Promise<void> {
    return this.control('resume');
  }

  startTimer(): Promise<void> {
    return this.control('starttimer');
  }

  async applyWheel(): Promise<string> {
    return this.exclusive(async () => {
      const phase = await this.readPhase();
      if (phase === 'Paused') {
        this.writeCommand('resume');
        return `resume (${phase})`;
      }
      if (phase === 'Running') {
        this.writeCommand('pause');
        return `pause (${phase})`;
      }
      this.writeCommand('starttimer');
      return `starttimer (${phase})`;
    });
  }

  async applyReset(): Promise<string | null> {
    return this.exclusive(async () => {
      const phase = await this.readPhase();
      if (phase === 'NotRunning') {
        return null;
      }
      this.writeCommand('reset');
      return `reset (${phase})`;
    });
  }

  private async readPhase(): Promise<TimerPhase> {
    const raw = await this.send('getcurrenttimerphase');
    return PHASES.has(raw as TimerPhase) ? (raw as TimerPhase) : 'NotRunning';
  }

  async getState(): Promise<LiveSplitState> {
    return this.exclusive(() => this.getStateUnlocked());
  }

  private async getStateUnlocked(): Promise<LiveSplitState> {
    const phaseRaw = await this.send('getcurrenttimerphase');
    const phase = PHASES.has(phaseRaw as TimerPhase)
      ? (phaseRaw as TimerPhase)
      : 'NotRunning';

    const timeMs = parseLiveSplitTime(await this.send('getcurrenttime')) ?? 0;
    const splitIndex = Number.parseInt(await this.send('getsplitindex'), 10);
    const index = Number.isFinite(splitIndex) ? splitIndex : -1;
    const attemptCount = await this.readAttemptCount();

    await this.refreshNames();

    let lastDeltaMs: number | null = null;
    let liveDeltaMs: number | null = null;
    let liveSegmentMs: number | null = null;
    let bestSegmentMs: number | null = null;
    let splitName = '';

    if (phase === 'Running' || phase === 'Paused') {
      lastDeltaMs = parseLiveSplitTime(await this.send('getdelta'));
      const comparisonMs = parseLiveSplitTime(
        await this.send('getcomparisonsplittime'),
      );
      if (comparisonMs !== null && index >= 0) {
        this.pbByIndex[index] = comparisonMs;
        liveDeltaMs = timeMs - comparisonMs;
      }
      const lastSplitMs = parseLiveSplitTime(await this.send('getlastsplittime'));
      if (index > 0 && lastSplitMs !== null) {
        this.runByIndex[index - 1] = lastSplitMs;
      }
      liveSegmentMs = lastSplitMs === null ? timeMs : timeMs - lastSplitMs;
      if (this.supportsBestSegments && index >= 0) {
        bestSegmentMs = await this.readBestSegment(index);
      }
      splitName = sanitizeSplitName(await this.send('getcurrentsplitname'));
    } else if (phase === 'Ended') {
      lastDeltaMs = parseLiveSplitTime(await this.send('getdelta'));
      liveDeltaMs = lastDeltaMs;
      const lastSplitMs = parseLiveSplitTime(await this.send('getlastsplittime'));
      if (lastSplitMs !== null && this.splitNames.length > 0) {
        this.runByIndex[this.splitNames.length - 1] = lastSplitMs;
      }
      splitName = sanitizeSplitName(await this.send('getprevioussplitname'));
    } else {
      this.runByIndex = this.splitNames.map(() => null);
    }

    const isGold =
      bestSegmentMs !== null &&
      liveSegmentMs !== null &&
      liveSegmentMs > 200 &&
      liveSegmentMs < bestSegmentMs;

    return {
      phase,
      timeMs,
      lastDeltaMs,
      liveDeltaMs,
      liveSegmentMs,
      bestSegmentMs,
      isGold,
      splitName,
      splitIndex: index,
      splitCount: this.splitNames.length,
      attemptCount,
      splits: this.splitNames.map((name, i) => ({
        name,
        pbMs: this.pbByIndex[i] ?? null,
        runMs: this.runByIndex[i] ?? null,
      })),
    };
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private control(command: string): Promise<void> {
    return this.exclusive(async () => {
      this.writeCommand(command);
    });
  }

  private async refreshNames(): Promise<void> {
    const count = await this.readSplitCount();
    if (count === this.splitNames.length && count > 0) {
      return;
    }

    const names: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const raw = await this.trySend(`getsplitname ${i}`);
      names.push(sanitizeSplitName(raw ?? ''));
    }
    this.splitNames = names;
    this.pbByIndex = names.map((_, i) => this.pbByIndex[i] ?? null);
    this.runByIndex = names.map((_, i) => this.runByIndex[i] ?? null);
    this.bsByIndex = names.map((_, i) => this.bsByIndex[i] ?? null);
  }

  private async readAttemptCount(): Promise<number> {
    if (!this.supportsAttemptCount) {
      return this.lastAttemptCount;
    }
    const raw = await this.trySend('getattemptcount');
    if (raw === null) {
      this.supportsAttemptCount = false;
      return this.lastAttemptCount;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return this.lastAttemptCount;
    }
    this.lastAttemptCount = parsed;
    return parsed;
  }

  private async readSplitCount(): Promise<number> {
    if (this.supportsSplitCount) {
      const raw = await this.trySend('getsplitcount');
      if (raw === null) {
        this.supportsSplitCount = false;
      } else {
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      }
    }
    if (this.splitNames.length > 0 || this.splitNamesProbed) {
      return this.splitNames.length;
    }
    this.splitNamesProbed = true;
    for (let i = 0; i < 64; i += 1) {
      const name = await this.trySend(`getsplitname ${i}`);
      if (name === null || name === '-' || !name.trim()) {
        return i;
      }
    }
    return 64;
  }

  private async trySend(command: string): Promise<string | null> {
    try {
      return await this.send(command);
    } catch (error) {
      if (!this.connected) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      return null;
    }
  }

  private async readBestSegment(index: number): Promise<number | null> {
    const raw = await this.trySend('getcomparisonsplittime Best Segments');
    if (raw === null) {
      this.supportsBestSegments = false;
      return null;
    }
    const cumulative = parseLiveSplitTime(raw);
    if (cumulative === null) {
      return null;
    }
    this.bsByIndex[index] = cumulative;
    const previous = index > 0 ? (this.bsByIndex[index - 1] ?? 0) : 0;
    return cumulative - previous;
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
        this.supportsBestSegments = true;
        this.supportsAttemptCount = true;
        this.supportsSplitCount = true;
        this.splitNamesProbed = false;
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

  private writeCommand(command: string): void {
    if (!this.connected) {
      throw new Error(`LiveSplit not connected, drop ${command}`);
    }
    if (this.protocol === 'ws') {
      this.ws?.send(command);
      return;
    }
    this.socket?.write(`${command}\r\n`);
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
      try {
        this.writeCommand(command);
      } catch (error) {
        const index = this.pending.indexOf(wrapped);
        if (index !== -1) {
          this.pending.splice(index, 1);
        }
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
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
