import type { RunSnapshot } from '../livesplit/types.js';

/** Below this a "segment" is usually a mis-split, not a real gold. */
export const MIN_GOLD_SEGMENT_MS = 200;

/**
 * A gold belongs to the segment that was just completed, the same split the
 * displayed delta describes. Judging the segment still in progress would light
 * up right after every split, while its length is still near zero.
 */
export function isGoldSegment(snapshot: RunSnapshot): boolean {
  const segment = snapshot.lastSegmentMs;
  const best = snapshot.lastBestSegmentMs;
  if (segment === null || best === null) {
    return false;
  }
  return segment > MIN_GOLD_SEGMENT_MS && segment < best;
}
