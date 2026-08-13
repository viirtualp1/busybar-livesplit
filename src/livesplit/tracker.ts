import {
  emptySnapshot,
  isTimerPhase,
  parseLiveSplitTime,
  sanitizeSplitName,
  type RunSnapshot,
  type SplitInfo,
  type TimerPhase,
} from './types.js';

export type CommandChannel = {
  readonly connected: boolean;
  send(command: string): Promise<string>;
  probe(command: string): Promise<string | null>;
};

type Support = 'unknown' | 'supported' | 'unsupported';

const RUN_RECHECK_MS = 2000;
const MAX_PROBED_SPLITS = 128;

/**
 * Turns the request/response protocol into a snapshot, keeping everything that
 * only changes on a split (comparison times, names, deltas) in a cache so a
 * steady frame costs three commands instead of ten.
 */
export class RunTracker {
  private support = new Map<string, Support>();
  private splitNames: string[] = [];
  private pbCumulative: Array<number | null> = [];
  private runCumulative: Array<number | null> = [];
  private bestCumulative: Array<number | null> = [];
  private fingerprint = '';
  private probedSplitCount: number | null = null;
  private runCheckedAt = Number.NEGATIVE_INFINITY;
  private attemptCount = 0;
  private phase: TimerPhase | null = null;
  private index: number | null = null;
  private splitName = '';
  private lastDeltaMs: number | null = null;
  private previousCumulativeMs: number | null = null;
  private comparisonMs: number | null = null;
  private bestSegmentMs: number | null = null;

  constructor(
    private readonly channel: CommandChannel,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Drops every cache; call after a reconnect, since feature support may differ. */
  reset(): void {
    this.support.clear();
    this.splitNames = [];
    this.pbCumulative = [];
    this.runCumulative = [];
    this.bestCumulative = [];
    this.fingerprint = '';
    this.probedSplitCount = null;
    this.runCheckedAt = Number.NEGATIVE_INFINITY;
    this.attemptCount = 0;
    this.phase = null;
    this.index = null;
    this.clearSplitCache();
  }

  async poll(): Promise<RunSnapshot> {
    const phaseRaw = await this.ask('getcurrenttimerphase');
    const phase = phaseRaw !== null && isTimerPhase(phaseRaw) ? phaseRaw : 'NotRunning';

    const timeRaw = await this.ask('getcurrenttime');
    const receivedAt = this.now();
    const timeMs = timeRaw === null ? 0 : (parseLiveSplitTime(timeRaw) ?? 0);

    const indexRaw = await this.ask('getsplitindex');
    const parsedIndex = indexRaw === null ? Number.NaN : Number.parseInt(indexRaw, 10);
    const index = Number.isFinite(parsedIndex) ? parsedIndex : -1;

    const phaseChanged = phase !== this.phase;
    const indexChanged = index !== this.index;
    this.phase = phase;
    this.index = index;

    if (phaseChanged || phase === 'NotRunning') {
      await this.refreshRun();
    }
    if (phaseChanged) {
      await this.refreshAttemptCount();
      this.clearSplitCache();
    }

    if (phase === 'NotRunning') {
      this.runCumulative = this.splitNames.map(() => null);
      this.bestCumulative = this.splitNames.map(() => null);
      this.clearSplitCache();
    } else if (indexChanged || phaseChanged) {
      await this.refreshSplitCache(phase, index);
    }

    const liveDeltaMs =
      phase === 'Ended'
        ? this.lastDeltaMs
        : this.comparisonMs === null
          ? null
          : timeMs - this.comparisonMs;

    const liveSegmentMs =
      phase === 'Running' || phase === 'Paused'
        ? this.previousCumulativeMs === null
          ? null
          : timeMs - this.previousCumulativeMs
        : null;

    return {
      ...emptySnapshot(receivedAt),
      phase,
      timeMs,
      lastDeltaMs: this.lastDeltaMs,
      liveDeltaMs,
      liveSegmentMs,
      bestSegmentMs: this.bestSegmentMs,
      splitName: this.splitName,
      splitIndex: index,
      attemptCount: this.attemptCount,
      splits: this.buildSplits(),
    };
  }

  private buildSplits(): SplitInfo[] {
    return this.splitNames.map((name, i) => ({
      name,
      pbMs: this.pbCumulative[i] ?? null,
      runMs: this.runCumulative[i] ?? null,
    }));
  }

  private clearSplitCache(): void {
    this.splitName = '';
    this.lastDeltaMs = null;
    this.previousCumulativeMs = null;
    this.comparisonMs = null;
    this.bestSegmentMs = null;
  }

  private async refreshSplitCache(phase: TimerPhase, index: number): Promise<void> {
    this.lastDeltaMs = parseLiveSplitTime((await this.ask('getdelta')) ?? '');

    const lastSplitMs = parseLiveSplitTime((await this.ask('getlastsplittime')) ?? '');
    this.previousCumulativeMs = index <= 0 ? 0 : lastSplitMs;

    if (phase === 'Ended') {
      const finished = this.splitNames.length - 1;
      if (finished >= 0 && lastSplitMs !== null) {
        this.runCumulative[finished] = lastSplitMs;
      }
      this.splitName = sanitizeSplitName((await this.ask('getprevioussplitname')) ?? '');
      this.comparisonMs = null;
      this.bestSegmentMs = null;
      return;
    }

    if (index > 0 && lastSplitMs !== null) {
      this.runCumulative[index - 1] = lastSplitMs;
    }

    this.comparisonMs = parseLiveSplitTime(
      (await this.ask('getcomparisonsplittime')) ?? '',
    );
    if (this.comparisonMs !== null && index >= 0) {
      this.pbCumulative[index] = this.comparisonMs;
    }

    this.splitName = sanitizeSplitName((await this.ask('getcurrentsplitname')) ?? '');
    this.bestSegmentMs = await this.readBestSegment(index);
  }

  /**
   * Best Segments is a cumulative comparison, so the segment length needs the
   * previous split's value. If this run never passed that split the length is
   * unknown — reporting null keeps a skipped split from faking a gold.
   */
  private async readBestSegment(index: number): Promise<number | null> {
    if (index < 0) {
      return null;
    }
    const raw = await this.ask('getcomparisonsplittime Best Segments');
    const cumulative = parseLiveSplitTime(raw ?? '');
    if (cumulative === null) {
      return null;
    }
    this.bestCumulative[index] = cumulative;

    if (index === 0) {
      return cumulative;
    }
    const previous = this.bestCumulative[index - 1];
    return previous === undefined || previous === null ? null : cumulative - previous;
  }

  private async refreshAttemptCount(): Promise<void> {
    const raw = await this.ask('getattemptcount');
    if (raw === null) {
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      this.attemptCount = parsed;
    }
  }

  /**
   * Split names are only reloaded when the run actually changes: a different
   * file with the same segment count would otherwise keep the old names and the
   * stale PB cache forever.
   */
  private async refreshRun(): Promise<void> {
    const now = this.now();
    if (this.splitNames.length > 0 && now - this.runCheckedAt < RUN_RECHECK_MS) {
      return;
    }
    this.runCheckedAt = now;

    const count = await this.readSplitCount();
    if (count === 0) {
      this.applyRun([]);
      return;
    }

    const first = sanitizeSplitName((await this.ask('getsplitname 0')) ?? '');
    const last =
      count > 1
        ? sanitizeSplitName((await this.ask(`getsplitname ${count - 1}`)) ?? '')
        : first;

    const fingerprint = `${count}|${first}|${last}`;
    if (fingerprint === this.fingerprint) {
      return;
    }
    this.fingerprint = fingerprint;

    const names: string[] = [];
    for (let i = 0; i < count; i += 1) {
      if (i === 0) {
        names.push(first);
        continue;
      }
      if (i === count - 1) {
        names.push(last);
        continue;
      }
      names.push(sanitizeSplitName((await this.ask(`getsplitname ${i}`)) ?? ''));
    }
    this.applyRun(names);
  }

  private applyRun(names: string[]): void {
    this.splitNames = names;
    this.pbCumulative = names.map(() => null);
    this.runCumulative = names.map(() => null);
    this.bestCumulative = names.map(() => null);
    this.clearSplitCache();
  }

  private async readSplitCount(): Promise<number> {
    const raw = await this.ask('getsplitcount');
    if (raw !== null) {
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }

    if (this.probedSplitCount !== null) {
      return this.probedSplitCount;
    }
    let count = 0;
    while (count < MAX_PROBED_SPLITS) {
      const name = await this.channel.probe(`getsplitname ${count}`);
      if (name === null || !name.trim() || name.trim() === '-') {
        break;
      }
      count += 1;
    }
    this.probedSplitCount = count;
    return count;
  }

  /**
   * LiveSplit stays silent on commands it does not know, so each one is probed
   * once and then sent normally — a plain send would time out and, since a
   * timeout is fatal, drop the connection on every poll.
   */
  private async ask(command: string): Promise<string | null> {
    const key = command.split(' ')[0] ?? command;
    const state = this.support.get(key) ?? 'unknown';

    if (state === 'unsupported') {
      return null;
    }
    if (state === 'supported') {
      return this.channel.send(command);
    }

    const reply = await this.channel.probe(command);
    this.support.set(key, reply === null ? 'unsupported' : 'supported');
    return reply;
  }
}
