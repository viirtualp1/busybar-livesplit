import type { RunSnapshot } from '../livesplit/types.js';

/**
 * While the timer runs its value is just arithmetic on the wall clock, so the
 * display can advance smoothly between polls instead of stepping once per poll.
 */
export function interpolatedTimeMs(snapshot: RunSnapshot, nowMs: number): number {
  if (snapshot.phase !== 'Running') {
    return snapshot.timeMs;
  }
  const elapsed = Math.max(0, nowMs - snapshot.receivedAt);
  return snapshot.timeMs + elapsed;
}

export function interpolatedSegmentMs(
  snapshot: RunSnapshot,
  nowMs: number,
): number | null {
  if (snapshot.liveSegmentMs === null) {
    return null;
  }
  return snapshot.liveSegmentMs + (interpolatedTimeMs(snapshot, nowMs) - snapshot.timeMs);
}

export function interpolatedDeltaMs(snapshot: RunSnapshot, nowMs: number): number | null {
  if (snapshot.liveDeltaMs === null) {
    return null;
  }
  return snapshot.liveDeltaMs + (interpolatedTimeMs(snapshot, nowMs) - snapshot.timeMs);
}
