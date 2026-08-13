import type { RunSnapshot } from '../livesplit/types.js';

/** Below this a "segment" is usually a mis-split, not a real gold. */
export const MIN_GOLD_SEGMENT_MS = 200;

export function isGoldSegment(snapshot: RunSnapshot, segmentMs: number | null): boolean {
  const best = snapshot.bestSegmentMs;
  if (best === null || segmentMs === null) {
    return false;
  }
  return segmentMs > MIN_GOLD_SEGMENT_MS && segmentMs < best;
}
