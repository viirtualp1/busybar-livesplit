import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  decodeTextFile,
  decodeXml,
  modifiedAt,
  readSplitsFile,
  type SplitsFileRun,
  type TimingMethod,
} from './splits-file.js';

const run = promisify(execFile);

/** Long enough that LiveSplit rewriting the file is picked up within a split. */
const RECHECK_MS = 5000;
const PROCESS_LOOKUP_MS = 5000;
/**
 * How long to wait before looking for LiveSplit again after not finding it.
 * Each look is a PowerShell process; at the five-second recheck that was twelve
 * a minute for as long as LiveSplit stayed closed.
 */
const LOOKUP_RETRY_MS = 60_000;

export type SplitsCandidate = {
  path: string;
  timingMethod: TimingMethod;
};

export type CatalogLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type CatalogDeps = {
  logger?: CatalogLogger;
  now?: () => number;
  locateDir?: () => Promise<string | null>;
};

const RECENT_ENTRY = /<SplitsFile\b([^>]*)>([\s\S]*?)<\/SplitsFile>/g;

/**
 * LiveSplit appends to `<RecentSplits>`, so the file it opened last sits at the
 * end. Reversing puts the most likely run first without making that the only
 * thing the caller may rely on.
 */
export function parseRecentSplits(cfg: string): SplitsCandidate[] {
  const recent = /<RecentSplits>([\s\S]*?)<\/RecentSplits>/.exec(cfg);
  if (recent === null) {
    return [];
  }

  const found: SplitsCandidate[] = [];
  for (const match of (recent[1] ?? '').matchAll(RECENT_ENTRY)) {
    const path = decodeXml((match[2] ?? '').trim());
    if (path) {
      found.push({
        path,
        timingMethod: /lastTimingMethod="GameTime"/i.test(match[1] ?? '')
          ? 'game'
          : 'real',
      });
    }
  }
  return found.reverse();
}

/**
 * LiveSplit is portable, so its settings live next to the executable.
 * `Get-Process.Path` is often empty for a 32-bit LiveSplit, and `-ExpandProperty`
 * then throws — CIM's ExecutablePath is the one that actually comes back.
 */
export async function liveSplitDir(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', FIND_LIVESPLIT],
      { timeout: PROCESS_LOOKUP_MS, windowsHide: true },
    );
    const exe = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return exe && existsSync(exe) ? dirname(exe) : null;
  } catch {
    return null;
  }
}

const FIND_LIVESPLIT = [
  '$p = Get-CimInstance -ClassName Win32_Process -Filter "Name LIKE \'LiveSplit%.exe\'" -ErrorAction SilentlyContinue |',
  '  Where-Object { $_.ExecutablePath } | Select-Object -First 1',
  'if ($p) { $p.ExecutablePath; exit }',
  "(Get-Process -Name 'LiveSplit*' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1).Path",
].join('\n');

/**
 * Keeps the parsed splits files the tracker may use. Periodic refreshes stay
 * off the poll path; {@link ready} is for the first frame, which has nothing
 * to draw until a load has been attempted.
 */
export class SplitsCatalog {
  private loaded: SplitsFileRun[] = [];
  private mtimes = new Map<string, number>();
  private dir: string | null = null;
  private lookedAt = Number.NEGATIVE_INFINITY;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;
  private announced = '';
  private warned = '';
  private readonly logger: CatalogLogger;
  private readonly now: () => number;
  private readonly locateDir: () => Promise<string | null>;

  constructor(
    private readonly explicitPath: string,
    deps: CatalogDeps = {},
  ) {
    this.logger = deps.logger ?? console;
    this.now = deps.now ?? (() => performance.now());
    this.locateDir = deps.locateDir ?? liveSplitDir;
    this.refresh();
  }

  /** Most recently opened first; empty until the first load finishes. */
  runs(): SplitsFileRun[] {
    return this.loaded;
  }

  refresh(): void {
    void this.schedule();
  }

  /** Resolves after a load has been attempted. */
  ready(): Promise<void> {
    return this.schedule();
  }

  private schedule(): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    const now = this.now();
    if (now - this.checkedAt < RECHECK_MS) {
      return Promise.resolve();
    }
    this.checkedAt = now;
    this.inflight = this.reload()
      .catch((error: unknown) => this.warnOnce(String(error)))
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async reload(): Promise<void> {
    const candidates = await this.candidates();
    if (candidates.length === 0) {
      this.loaded = [];
      this.mtimes = new Map();
      this.warnOnce(
        this.explicitPath
          ? `SPLITS_FILE=${this.explicitPath} was not found`
          : 'No LiveSplit splits file found, the back screen will fill in as you split',
      );
      return;
    }

    if (!(await this.changed(candidates))) {
      return;
    }

    const runs: SplitsFileRun[] = [];
    for (const candidate of candidates) {
      try {
        const parsed = await readSplitsFile(candidate.path, candidate.timingMethod);
        if (parsed !== null) {
          runs.push(parsed);
        }
      } catch (error) {
        this.warnOnce(`Cannot read ${candidate.path}: ${String(error)}`);
      }
    }

    this.loaded = runs;
    this.announce(runs[0]);
  }

  /** A file is only re-parsed once its timestamp moves. */
  private async changed(candidates: SplitsCandidate[]): Promise<boolean> {
    const seen = new Map<string, number>();
    let changed = candidates.length !== this.mtimes.size;

    for (const candidate of candidates) {
      const mtime = await modifiedAt(candidate.path).catch(() => 0);
      seen.set(candidate.path, mtime);
      if (this.mtimes.get(candidate.path) !== mtime) {
        changed = true;
      }
    }

    this.mtimes = seen;
    return changed;
  }

  private async candidates(): Promise<SplitsCandidate[]> {
    const recent = await this.recentSplits();
    const found: SplitsCandidate[] = [];

    if (this.explicitPath && existsSync(this.explicitPath)) {
      const known = recent.find((entry) => samePath(entry.path, this.explicitPath));
      found.push({
        path: this.explicitPath,
        timingMethod: known?.timingMethod ?? 'real',
      });
    }

    for (const entry of recent) {
      if (
        existsSync(entry.path) &&
        !found.some((candidate) => samePath(candidate.path, entry.path))
      ) {
        found.push(entry);
      }
    }
    return found;
  }

  private async recentSplits(): Promise<SplitsCandidate[]> {
    if (this.dir === null) {
      const now = this.now();
      if (now - this.lookedAt < LOOKUP_RETRY_MS) {
        return [];
      }
      this.lookedAt = now;
      this.dir = await this.locateDir();
    }
    if (this.dir === null) {
      return [];
    }

    return [...(await this.fromSettings()), ...(await this.localSplits())];
  }

  private async fromSettings(): Promise<SplitsCandidate[]> {
    if (this.dir === null) {
      return [];
    }
    try {
      return parseRecentSplits(
        decodeTextFile(await readFile(join(this.dir, 'settings.cfg'))),
      );
    } catch {
      return [];
    }
  }

  /** Nearby `.lss` files when settings.cfg has no usable RecentSplits. */
  private async localSplits(): Promise<SplitsCandidate[]> {
    if (this.dir === null) {
      return [];
    }
    try {
      const names = await readdir(this.dir);
      return names
        .filter((name) => name.toLowerCase().endsWith('.lss'))
        .map((name) => ({ path: join(this.dir as string, name), timingMethod: 'real' }));
    } catch {
      return [];
    }
  }

  private announce(run: SplitsFileRun | undefined): void {
    if (run === undefined || this.announced === run.path) {
      return;
    }
    this.announced = run.path;
    const title = [run.gameName, run.categoryName].filter(Boolean).join(' — ');
    const withPb = run.segments.filter((segment) => segment.pbMs !== null).length;
    this.logger.info(
      `Splits: ${title || 'unknown run'}, ${run.segments.length} segments, ${withPb} with PB (${run.path})`,
    );
  }

  private warnOnce(message: string): void {
    if (this.warned !== message) {
      this.warned = message;
      this.logger.warn(message);
    }
  }
}

function samePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
