import { ServerCapabilities, type ServerFeature } from './capabilities.js';
import { LiveSplitTimeoutError } from './connection.js';
import type { SplitsFileRun } from './splits-file.js';
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

/** The parsed splits files the tracker may lay a run out from, best guess first. */
export type RunCatalog = {
  runs(): SplitsFileRun[];
  refresh(): void;
  /** First layout waits on this so the back screen is not empty for a few polls. */
  ready?(): Promise<void>;
};

export type TrackerOptions = {
  now?: () => number;
  capabilities?: ServerCapabilities;
  catalog?: RunCatalog;
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

function fingerprintOf(run: SplitsFileRun): string {
  const last = run.segments[run.segments.length - 1]?.name ?? '';
  return `file|${run.path}|${run.segments.length}|${run.segments[0]?.name ?? ''}|${last}`;
}

/**
 * Turns the request/response protocol into a snapshot, keeping everything that
 * only changes on a split (comparison times, names, deltas) in a cache so a
 * steady frame costs three commands instead of ten.
 *
 * No released LiveSplit can list a run's segments — `getsplitcount` and
 * `getsplitname` only exist on master — so the layout comes from the splits
 * file when one is found, and otherwise from the names the timer hands out as
 * the run walks past them. Both fill the same sparse caches, which is why every
 * index is written through {@link observe} rather than sized up front.
 */
export class RunTracker {
  private splitNames: string[] = [];
  private pbCumulative: Array<number | null> = [];
  private runCumulative: Array<number | null> = [];
  private bestCumulative: Array<number | null> = [];
  private fileBestSegment: Array<number | null> = [];
  private fileRun: SplitsFileRun | null = null;
  /** Total segments once something authoritative said so, `null` while guessing. */
  private splitCount: number | null = null;
  private discovered = 0;
  private fingerprint = '';
  private runCheckedAt = Number.NEGATIVE_INFINITY;
  private staleSplitCache = false;
  private mismatchWarned = '';
  private attemptCount = 0;
  private phase: TimerPhase | null = null;
  private index: number | null = null;
  private splitName = '';
  private advancing = false;
  private previousTimeMs: number | null = null;
  private previousReceivedAt = 0;
  private lastDeltaMs: number | null = null;
  private comparisonMs: number | null = null;
  private lastSegmentMs: number | null = null;
  private lastBestSegmentMs: number | null = null;

  private readonly now: () => number;
  private readonly capabilities: ServerCapabilities;
  private readonly catalog: RunCatalog | null;

  constructor(
    private readonly channel: CommandChannel,
    options: TrackerOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.capabilities = options.capabilities ?? new ServerCapabilities();
    this.catalog = options.catalog ?? null;
  }

  /** Drops the run caches; feature support is kept, it belongs to the server. */
  reset(): void {
    this.splitNames = [];
    this.pbCumulative = [];
    this.runCumulative = [];
    this.bestCumulative = [];
    this.fileBestSegment = [];
    this.fileRun = null;
    this.splitCount = null;
    this.discovered = 0;
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

    // An unknown layout is retried every poll: the splits file may still load.
    if (phaseChanged || phase === 'NotRunning' || this.length === 0) {
      await this.refreshRun();
    }
    if (phaseChanged) {
      await this.refreshAttemptCount();
      this.clearSplitCache();
    }

    if (phase === 'NotRunning') {
      this.runCumulative = [];
      this.bestCumulative = [];
      this.clearSplitCache();
    } else if (indexChanged || phaseChanged || this.staleSplitCache) {
      await this.refreshSplitCache(phase, index);
    }
    this.staleSplitCache = false;

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

  /** Known segments: the real total when it is known, else what has been seen. */
  private get length(): number {
    return this.splitCount ?? this.discovered;
  }

  private buildSplits(): SplitInfo[] {
    const splits: SplitInfo[] = [];
    for (let i = 0; i < this.length; i += 1) {
      splits.push({
        name: this.splitNames[i] ?? '',
        pbMs: this.pbCumulative[i] ?? null,
        runMs: this.runCumulative[i] ?? null,
      });
    }
    return splits;
  }

  /** Every index the timer mentions is a row the back screen may already draw. */
  private observe(index: number): void {
    if (index >= 0 && index + 1 > this.discovered) {
      this.discovered = index + 1;
    }
  }

  private learnName(index: number, name: string): void {
    if (index < 0) {
      return;
    }
    if (name) {
      this.splitNames[index] = name;
    }
    this.observe(index);
  }

  private clearSplitCache(): void {
    this.splitName = '';
    this.lastDeltaMs = null;
    this.comparisonMs = null;
    this.lastSegmentMs = null;
    this.lastBestSegmentMs = null;
  }

  private async refreshSplitCache(phase: TimerPhase, index: number): Promise<void> {
    this.lastDeltaMs = parseLiveSplitTime((await this.ask('getdelta')) ?? '');

    const lastSplitMs = parseLiveSplitTime((await this.ask('getlastsplittime')) ?? '');

    /*
     * `getprevioussplitname` is documented as the segment before the current
     * index, so the segment that just ended is always `index - 1` — including
     * when the run ends and the index moves past the last split.
     */
    const finished = index - 1;
    if (finished >= 0 && lastSplitMs !== null) {
      this.runCumulative[finished] = lastSplitMs;
      this.observe(finished);
    }

    if (phase === 'Ended') {
      this.splitName = sanitizeSplitName((await this.ask('getprevioussplitname')) ?? '');
      this.learnName(finished, this.splitName);
      this.comparisonMs = null;
      this.recordFinishedSegment(finished);
      return;
    }

    this.recordFinishedSegment(finished);

    this.comparisonMs = parseLiveSplitTime(
      (await this.ask('getcomparisonsplittime')) ?? '',
    );
    if (this.comparisonMs !== null && index >= 0) {
      this.pbCumulative[index] = this.comparisonMs;
      this.observe(index);
    }

    this.splitName = sanitizeSplitName((await this.ask('getcurrentsplitname')) ?? '');
    this.checkFileRun(index, this.splitName);
    this.learnName(index, this.splitName);
    await this.learnPreviousName(finished);
    await this.cacheBestSegment(index);
  }

  /**
   * Without a splits file the run is only ever known as far as it has been
   * played, so the name behind the current split is worth one command the first
   * time it is seen.
   */
  private async learnPreviousName(finished: number): Promise<void> {
    if (finished < 0 || this.splitNames[finished]) {
      return;
    }
    this.learnName(
      finished,
      sanitizeSplitName((await this.ask('getprevioussplitname')) ?? ''),
    );
  }

  /**
   * Both lengths come from the cumulative caches, so a split this run never
   * passed leaves them null — which keeps a skipped split from faking a gold.
   * The splits file only fills in for a server without a Best Segments
   * comparison to offer.
   */
  private recordFinishedSegment(finished: number): void {
    this.lastSegmentMs = segmentLength(this.runCumulative, finished);
    this.lastBestSegmentMs =
      segmentLength(this.bestCumulative, finished) ??
      (finished < 0 ? null : (this.fileBestSegment[finished] ?? null));
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
      const stored = this.fileRun?.attemptCount ?? null;
      if (stored !== null) {
        this.attemptCount = stored;
      }
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      this.attemptCount = parsed;
    }
  }

  /**
   * The layout is only reloaded when the run actually changes: a different file
   * with the same segment count would otherwise keep the old names and the
   * stale PB cache forever.
   */
  private async refreshRun(): Promise<void> {
    const now = this.now();
    if (this.length > 0 && now - this.runCheckedAt < RUN_RECHECK_MS) {
      return;
    }
    this.runCheckedAt = now;

    if (this.length === 0) {
      await this.catalog?.ready?.();
    } else {
      this.catalog?.refresh();
    }

    if (this.applyStoredRun()) {
      return;
    }
    await this.applyServerRun();
  }

  /** Uses the splits file whose names line up with the run on screen. */
  private applyStoredRun(): boolean {
    const runs = this.catalog?.runs() ?? [];
    if (runs.length === 0) {
      return false;
    }

    const chosen = this.chooseRun(runs);
    if (chosen === null) {
      return false;
    }

    const fingerprint = fingerprintOf(chosen);
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      this.applyRunFile(chosen);
    }
    return true;
  }

  /**
   * While the timer sits at no split any file is as good a guess as the next, so
   * the most recently opened one wins and {@link checkFileRun} corrects it as
   * soon as the run names something.
   */
  private chooseRun(runs: SplitsFileRun[]): SplitsFileRun | null {
    const index = this.index ?? -1;
    if (!this.splitName || index < 0) {
      return runs[0] ?? null;
    }
    return runs.find((run) => run.segments[index]?.name === this.splitName) ?? null;
  }

  /** A file that disagrees with the live split names describes some other run. */
  private checkFileRun(index: number, liveName: string): void {
    const active = this.fileRun;
    if (active === null || !liveName || index < 0) {
      return;
    }
    const stored = active.segments[index]?.name;
    if (stored === undefined || stored === liveName) {
      return;
    }

    if (this.mismatchWarned !== active.path) {
      this.mismatchWarned = active.path;
      console.warn(
        `Splits file does not match the run in LiveSplit ("${stored}" vs "${liveName}"), ` +
          `ignoring ${active.path}`,
      );
    }
    this.dropStoredRun();
  }

  private dropStoredRun(): void {
    this.fileRun = null;
    this.fileBestSegment = [];
    this.splitCount = null;
    this.splitNames = [];
    this.pbCumulative = [];
    this.discovered = 0;
    this.fingerprint = '';
    this.runCheckedAt = Number.NEGATIVE_INFINITY;
  }

  private applyRunFile(run: SplitsFileRun): void {
    this.fileRun = run;
    this.splitCount = run.segments.length;
    this.splitNames = run.segments.map((segment) => segment.name);
    this.pbCumulative = run.segments.map((segment) => segment.pbMs);
    this.fileBestSegment = run.segments.map((segment) => segment.bestSegmentMs);
    this.runCumulative = [];
    this.bestCumulative = [];
    this.discovered = run.segments.length;
    this.staleSplitCache = true;
  }

  /**
   * Only master builds answer these. A server without them leaves the layout
   * alone: whatever the run has already walked past is better than nothing.
   */
  private async applyServerRun(): Promise<void> {
    const count = await this.readSplitCount();
    if (count === 0) {
      return;
    }

    // Times still line up with indices, so the rows are usable without names.
    if (!this.capabilities.supports('splitNames')) {
      await this.applyIfChanged(`count|${count}`, () =>
        Array.from({ length: count }, () => ''),
      );
      return;
    }

    const first = sanitizeSplitName((await this.askSplitName(0)) ?? '');
    const last =
      count > 1 ? sanitizeSplitName((await this.askSplitName(count - 1)) ?? '') : first;

    await this.applyIfChanged(`server|${count}|${first}|${last}`, async () => {
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
    this.fileRun = null;
    this.fileBestSegment = [];
    this.splitNames = names;
    this.splitCount = names.length;
    this.pbCumulative = [];
    this.runCumulative = [];
    this.bestCumulative = [];
    this.discovered = names.length;
    this.clearSplitCache();
    this.staleSplitCache = true;
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
