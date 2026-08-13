import { ServerCapabilities, type ServerFeature } from './capabilities.js';
import { LiveSplitTimeoutError } from './connection.js';
import {
  emptySnapshot,
  isTimerPhase,
  parseLiveSplitTime,
  replyValue,
  sanitizeSplitName,
  type RunSnapshot,
  type SplitInfo,
  type TimerPhase,
} from './types.js';

export type CommandChannel = {
  readonly connected: boolean;
  send(command: string): Promise<string>;
  trySend(command: string): Promise<string | null>;
};

const RUN_RECHECK_MS = 2000;

/** Well below 1 so a slow reply cannot be mistaken for a stopped timer. */
const MIN_PROGRESS_RATE = 0.5;

function segmentLength(cumulative: Array<number | null>, index: number): number | null {
  if (index < 0) {
    return null;
  }
  const at = cumulative[index] ?? null;
  if (at === null) {
    return null;
  }
  if (index === 0) {
    return at;
  }
  const before = cumulative[index - 1] ?? null;
  return before === null ? null : at - before;
}

/**
 * Turns the request/response protocol into a snapshot, keeping everything that
 * only changes on a split (comparison times, names, deltas) in a cache so a
 * steady frame costs three commands instead of ten.
 */
export class RunTracker {
  private splitNames: string[] = [];
  private pbCumulative: Array<number | null> = [];
  private runCumulative: Array<number | null> = [];
  private bestCumulative: Array<number | null> = [];
  private fingerprint = '';
  private runCheckedAt = Number.NEGATIVE_INFINITY;
  private attemptCount = 0;
  private phase: TimerPhase | null = null;
  private index: number | null = null;
  private splitName = '';
  private advancing = false;
  private previousTimeMs: number | null = null;
  private previousReceivedAt = 0;
  private lastDeltaMs: number | null = null;
  private previousCumulativeMs: number | null = null;
  private comparisonMs: number | null = null;
  private lastSegmentMs: number | null = null;
  private lastBestSegmentMs: number | null = null;

  constructor(
    private readonly channel: CommandChannel,
    private readonly now: () => number = () => performance.now(),
    private readonly capabilities = new ServerCapabilities(),
  ) {}

  /** Drops the run caches; feature support is kept, it belongs to the server. */
  reset(): void {
    this.splitNames = [];
    this.pbCumulative = [];
    this.runCumulative = [];
    this.bestCumulative = [];
    this.fingerprint = '';
    this.runCheckedAt = Number.NEGATIVE_INFINITY;
    this.attemptCount = 0;
    this.phase = null;
    this.index = null;
    this.advancing = false;
    this.previousTimeMs = null;
    this.previousReceivedAt = 0;
    this.clearSplitCache();
  }

  async poll(): Promise<RunSnapshot> {
    if (!this.capabilities.complete) {
      await this.capabilities.detect(this.channel);
    }

    const phaseRaw = await this.ask('getcurrenttimerphase');
    const phase = phaseRaw !== null && isTimerPhase(phaseRaw) ? phaseRaw : 'NotRunning';

    const timeRaw = await this.ask('getcurrenttime');
    const receivedAt = this.now();
    const timeMs = timeRaw === null ? 0 : (parseLiveSplitTime(timeRaw) ?? 0);

    const indexRaw = await this.ask('getsplitindex');
    const parsedIndex = indexRaw === null ? Number.NaN : Number.parseInt(indexRaw, 10);
    const index = Number.isFinite(parsedIndex) ? parsedIndex : -1;

    this.advancing = this.observeProgress(phase, timeMs, receivedAt);

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

    return {
      ...emptySnapshot(receivedAt),
      phase,
      timeMs,
      advancing: this.advancing,
      lastDeltaMs: this.lastDeltaMs,
      liveDeltaMs,
      lastSegmentMs: this.lastSegmentMs,
      lastBestSegmentMs: this.lastBestSegmentMs,
      splitName: this.splitName,
      splitIndex: index,
      attemptCount: this.attemptCount,
      splits: this.buildSplits(),
    };
  }

  /**
   * A paused timer keeps answering the same time, so the display may only run
   * ahead of a poll once two of them agree the run clock is actually moving.
   */
  private observeProgress(
    phase: TimerPhase,
    timeMs: number,
    receivedAt: number,
  ): boolean {
    const previousTimeMs = this.previousTimeMs;
    const realElapsed = receivedAt - this.previousReceivedAt;
    this.previousTimeMs = timeMs;
    this.previousReceivedAt = receivedAt;

    if (phase !== 'Running' || previousTimeMs === null) {
      return false;
    }
    if (realElapsed <= 0) {
      return this.advancing;
    }
    return timeMs - previousTimeMs >= realElapsed * MIN_PROGRESS_RATE;
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
    this.lastSegmentMs = null;
    this.lastBestSegmentMs = null;
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
      this.recordFinishedSegment(finished);
      return;
    }

    if (index > 0 && lastSplitMs !== null) {
      this.runCumulative[index - 1] = lastSplitMs;
    }
    this.recordFinishedSegment(index - 1);

    this.comparisonMs = parseLiveSplitTime(
      (await this.ask('getcomparisonsplittime')) ?? '',
    );
    if (this.comparisonMs !== null && index >= 0) {
      this.pbCumulative[index] = this.comparisonMs;
    }

    this.splitName = sanitizeSplitName((await this.ask('getcurrentsplitname')) ?? '');
    await this.cacheBestSegment(index);
  }

  /**
   * Both lengths come from the cumulative caches, so a split this run never
   * passed leaves them null — which keeps a skipped split from faking a gold.
   */
  private recordFinishedSegment(finished: number): void {
    this.lastSegmentMs = segmentLength(this.runCumulative, finished);
    this.lastBestSegmentMs = segmentLength(this.bestCumulative, finished);
  }

  /** Best Segments is cumulative, so each split's value is kept for later diffs. */
  private async cacheBestSegment(index: number): Promise<void> {
    if (index < 0) {
      return;
    }
    const raw = await this.askOptional(
      'bestSegments',
      'getcomparisonsplittime Best Segments',
    );
    const cumulative = raw === null ? null : parseLiveSplitTime(raw);
    if (cumulative !== null) {
      this.bestCumulative[index] = cumulative;
    }
  }

  private async refreshAttemptCount(): Promise<void> {
    const raw = await this.askOptional('attemptCount', 'getattemptcount');
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

    // Times still line up with indices, so the rows are usable without names.
    if (!this.capabilities.supports('splitNames')) {
      await this.applyIfChanged(`${count}`, () =>
        Array.from({ length: count }, () => ''),
      );
      return;
    }

    const first = sanitizeSplitName((await this.askSplitName(0)) ?? '');
    const last =
      count > 1 ? sanitizeSplitName((await this.askSplitName(count - 1)) ?? '') : first;

    await this.applyIfChanged(`${count}|${first}|${last}`, async () => {
      const names: string[] = [];
      for (let i = 0; i < count; i += 1) {
        if (i === 0) {
          names.push(first);
        } else if (i === count - 1) {
          names.push(last);
        } else {
          names.push(sanitizeSplitName((await this.askSplitName(i)) ?? ''));
        }
      }
      return names;
    });
  }

  private async applyIfChanged(
    fingerprint: string,
    build: () => string[] | Promise<string[]>,
  ): Promise<void> {
    if (fingerprint === this.fingerprint) {
      return;
    }
    this.fingerprint = fingerprint;
    this.applyRun(await build());
  }

  private applyRun(names: string[]): void {
    this.splitNames = names;
    this.pbCumulative = names.map(() => null);
    this.runCumulative = names.map(() => null);
    this.bestCumulative = names.map(() => null);
    this.clearSplitCache();
  }

  private async askSplitName(index: number): Promise<string | null> {
    return this.askOptional('splitNames', `getsplitname ${index}`);
  }

  private async readSplitCount(): Promise<number> {
    const raw = await this.askOptional('splitCount', 'getsplitcount');
    if (raw === null) {
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private async ask(command: string): Promise<string | null> {
    return replyValue(await this.channel.send(command));
  }

  /**
   * Only sent once the probe confirmed the command exists. Should it still kill
   * the connection — LiveSplit throws on a comparison it cannot find — the
   * feature is retired rather than repeated on every reconnect.
   */
  private async askOptional(
    feature: ServerFeature,
    command: string,
  ): Promise<string | null> {
    if (!this.capabilities.supports(feature)) {
      return null;
    }
    try {
      return replyValue(await this.channel.send(command));
    } catch (error) {
      if (error instanceof LiveSplitTimeoutError && error.command === command) {
        this.capabilities.disable(feature);
      }
      throw error;
    }
  }
}
