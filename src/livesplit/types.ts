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
  const head = parts.length > 2 ? splitDays(parts[0] ?? '') : { days: 0, hours: 0 };
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(head.hours) ||
    !Number.isFinite(head.days)
  ) {
    return null;
  }

  const ms =
    head.days * 86_400_000 + head.hours * 3_600_000 + minutes * 60_000 + seconds * 1000;
  return negative ? -ms : ms;
}

/** .NET writes a TimeSpan past 24h as `d.hh:mm:ss`, so the head may carry days. */
function splitDays(head: string): { days: number; hours: number } {
  const dot = head.indexOf('.');
  if (dot < 0) {
    return { days: 0, hours: Number(head) };
  }
  return {
    days: Number(head.slice(0, dot)),
    hours: Number(head.slice(dot + 1)),
  };
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

/**
 * LiveSplit's Subsplits component reads markup out of the segment name itself:
 * a leading `-` makes the segment a subsplit, and `{Section}` in front of it
 * names the group the segment closes. Neither belongs on a 82px wide row.
 */
export function stripSubsplitMarkup(raw: string): string {
  return raw.trim().replace(/^\{[^}]*\}/, '').replace(/^-/, '').trim();
}

/** The Bar fonts only cover printable ASCII, so anything else has to be mapped. */
export function sanitizeSplitName(raw: string): string {
  const transliterated = [...stripSubsplitMarkup(raw).normalize('NFKD')]
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
