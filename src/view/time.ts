const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `m:ss.hh`, or `h:mm:ss.hh` past an hour. Negative for a start offset countdown. */
export function formatTimer(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / HOUR_MS);
  const minutes = Math.floor((abs % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((abs % MINUTE_MS) / 1000);
  const hundredths = Math.floor((abs % 1000) / 10);

  if (hours > 0) {
    return `${sign}${hours}:${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
  }
  return `${sign}${minutes}:${pad(seconds)}.${pad(hundredths)}`;
}

/** Column-friendly: `s.t` under a minute, `m:ss` under an hour, `h:mm:ss` above. */
export function formatSplitTime(ms: number | null): string {
  if (ms === null) {
    return '--';
  }
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / HOUR_MS);
  const minutes = Math.floor((abs % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((abs % MINUTE_MS) / 1000);

  if (hours > 0) {
    return `${sign}${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  if (minutes > 0) {
    return `${sign}${minutes}:${pad(seconds)}`;
  }
  const tenths = Math.floor((abs % 1000) / 100);
  return `${sign}${seconds}.${tenths}`;
}

/**
 * Never longer than `MAX_DELTA_CHARS`, so it always fits the slot next to the
 * split name: big gaps drop to whole minutes or hours instead of growing wider.
 */
export const MAX_DELTA_CHARS = 5;

export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / HOUR_MS);
  const minutes = Math.floor((abs % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((abs % MINUTE_MS) / 1000);

  if (hours >= 10) {
    return `${sign}${hours}h`;
  }
  if (hours > 0) {
    return `${sign}${hours}:${pad(minutes)}`;
  }
  if (minutes >= 10) {
    return `${sign}${minutes}m`;
  }
  if (minutes > 0) {
    return `${sign}${minutes}:${pad(seconds)}`;
  }
  const tenths = Math.floor((abs % 1000) / 100);
  return `${sign}${seconds}.${tenths}`;
}
