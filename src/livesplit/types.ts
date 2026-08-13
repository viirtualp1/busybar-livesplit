export type TimerPhase = 'NotRunning' | 'Running' | 'Paused' | 'Ended';
export type LiveSplitProtocol = 'auto' | 'tcp' | 'ws';

export const PHASES: readonly TimerPhase[] = ['NotRunning', 'Running', 'Paused', 'Ended'];

export function isTimerPhase(value: string): value is TimerPhase {
  return (PHASES as readonly string[]).includes(value);
}

export type SplitInfo = {
  name: string;
  pbMs: number | null;
  runMs: number | null;
};

export type RunSnapshot = {
  phase: TimerPhase;
  timeMs: number;
  /** Monotonic timestamp of the `getcurrenttime` reply, for local interpolation. */
  receivedAt: number;
  /**
   * Two polls in a row saw the timer move. LiveSplit reports Running while the
   * clock stands still — game time paused, loading times, an autosplitter — and
   * interpolating those would race ahead and snap back on every poll.
   */
  advancing: boolean;
  lastDeltaMs: number | null;
  liveDeltaMs: number | null;
  /** How long the segment that was just completed took, and its record to beat. */
  lastSegmentMs: number | null;
  lastBestSegmentMs: number | null;
  splitName: string;
  splitIndex: number;
  attemptCount: number;
  splits: SplitInfo[];
};

export function emptySnapshot(receivedAt = 0): RunSnapshot {
  return {
    phase: 'NotRunning',
    timeMs: 0,
    receivedAt,
    advancing: false,
    lastDeltaMs: null,
    liveDeltaMs: null,
    lastSegmentMs: null,
    lastBestSegmentMs: null,
    splitName: '',
    splitIndex: -1,
    attemptCount: 0,
    splits: [],
  };
}

/**
 * LiveSplit answers "-" when a value is missing, and the older server component
 * reports failures as "[Error]: ..." on the same channel — neither is data.
 */
export function replyValue(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const value = raw.trim();
  if (!value || value === '-' || value === '?' || value.startsWith('[Error]')) {
    return null;
  }
  return value;
}

export function parseLiveSplitTime(raw: string): number | null {
  const value = raw.trim();
  if (!value || value === '-' || value === '?') {
    return null;
  }

  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const parts = body.split(':');
  if (parts.length > 3) {
    return null;
  }

  const seconds = Number.parseFloat(parts[parts.length - 1] ?? '');
  const minutes = parts.length > 1 ? Number(parts[parts.length - 2]) : 0;
  const hours = parts.length > 2 ? Number(parts[0]) : 0;
  if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || !Number.isFinite(hours)) {
    return null;
  }

  const ms = hours * 3_600_000 + minutes * 60_000 + seconds * 1000;
  return negative ? -ms : ms;
}

const TRANSLITERATION: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** The Bar fonts only cover printable ASCII, so anything else has to be mapped. */
export function sanitizeSplitName(raw: string): string {
  const transliterated = [...raw.normalize('NFKD')]
    .map((char) => {
      const lower = char.toLowerCase();
      const mapped = TRANSLITERATION[lower];
      if (mapped === undefined) {
        return char;
      }
      if (char === lower) {
        return mapped;
      }
      return mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join('');

  const cleaned = transliterated
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned === '-' ? '' : cleaned;
}
