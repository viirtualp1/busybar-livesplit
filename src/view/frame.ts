import {
  interpolatedDeltaMs,
  interpolatedSegmentMs,
  interpolatedTimeMs,
} from '../domain/clock.js';
import type { RunEvent } from '../domain/events.js';
import { isPersonalBest } from '../domain/events.js';
import { isGoldSegment } from '../domain/gold.js';
import type { RunSnapshot, SplitInfo } from '../livesplit/types.js';
import { COLORS } from './colors.js';
import { formatDelta, formatSplitTime, formatTimer } from './time.js';

export type BackRow = {
  name: string;
  time: string;
  pb: string;
  current: boolean;
  color: string;
};

export type TimerFrame = {
  timeText: string;
  splitText: string;
  deltaText: string;
  attemptText: string;
  timeColor: string;
  splitColor: string;
  deltaColor: string;
  ledColor: string | null;
  backHeader: string;
  backRows: BackRow[];
};

export type FrameOptions = {
  nowMs: number;
  maxRows: number;
  flash?: RunEvent;
};

export function buildFrame(snapshot: RunSnapshot, options: FrameOptions): TimerFrame {
  const { nowMs, maxRows, flash = null } = options;

  const timeMs = interpolatedTimeMs(snapshot, nowMs);
  const liveDeltaMs = interpolatedDeltaMs(snapshot, nowMs);
  const segmentMs = interpolatedSegmentMs(snapshot, nowMs);
  const gold = isGoldSegment(snapshot, segmentMs);

  const timeColor = timerColor(snapshot, liveDeltaMs);
  const deltaMs = displayedDelta(snapshot, liveDeltaMs);
  const attemptText = `#${snapshot.attemptCount}`;

  const base = {
    timeText: formatTimer(timeMs),
    attemptText,
    deltaText: deltaMs === null ? '' : formatDelta(deltaMs),
    timeColor,
    deltaColor: gold ? COLORS.bestSegment : timeColor,
    ledColor: ledForEvent(flash),
    backHeader: attemptText,
    backRows: buildBackRows(snapshot, timeMs, gold, maxRows),
  };

  if (snapshot.phase === 'NotRunning') {
    return {
      ...base,
      splitText: 'READY',
      splitColor: COLORS.notRunning,
      timeColor: COLORS.notRunning,
      deltaColor: COLORS.notRunning,
    };
  }
  if (snapshot.phase === 'Paused') {
    return {
      ...base,
      splitText: snapshot.splitName || 'PAUSED',
      splitColor: COLORS.paused,
    };
  }
  if (snapshot.phase === 'Ended') {
    return {
      ...base,
      splitText: snapshot.splitName || 'DONE',
      splitColor: timeColor,
    };
  }
  return {
    ...base,
    splitText: snapshot.splitName || 'RUNNING',
    splitColor: COLORS.white,
  };
}

function displayedDelta(
  snapshot: RunSnapshot,
  liveDeltaMs: number | null,
): number | null {
  if (snapshot.phase === 'NotRunning') {
    return null;
  }
  if (snapshot.phase === 'Ended') {
    return liveDeltaMs ?? snapshot.lastDeltaMs;
  }
  if (liveDeltaMs === null) {
    return snapshot.lastDeltaMs;
  }
  // Losing time shows live, otherwise the last split's delta stays put.
  if (
    liveDeltaMs > 0 ||
    (snapshot.lastDeltaMs !== null && liveDeltaMs > snapshot.lastDeltaMs)
  ) {
    return liveDeltaMs;
  }
  return snapshot.lastDeltaMs;
}

function timerColor(snapshot: RunSnapshot, liveDeltaMs: number | null): string {
  if (snapshot.phase === 'NotRunning') {
    return COLORS.notRunning;
  }
  if (snapshot.phase === 'Ended') {
    return isPersonalBest(snapshot) ? COLORS.personalBest : COLORS.behindLosing;
  }
  return runningColor(liveDeltaMs, snapshot.lastDeltaMs);
}

function runningColor(liveDeltaMs: number | null, lastDeltaMs: number | null): string {
  if (liveDeltaMs === null || liveDeltaMs === 0) {
    return COLORS.aheadGaining;
  }
  if (liveDeltaMs < 0) {
    return lastDeltaMs !== null && liveDeltaMs > lastDeltaMs
      ? COLORS.aheadLosing
      : COLORS.aheadGaining;
  }
  return lastDeltaMs !== null && liveDeltaMs < lastDeltaMs
    ? COLORS.behindGaining
    : COLORS.behindLosing;
}

function buildBackRows(
  snapshot: RunSnapshot,
  timeMs: number,
  gold: boolean,
  maxRows: number,
): BackRow[] {
  const splits = snapshot.splits;
  if (splits.length === 0 || maxRows <= 0) {
    return [];
  }

  const current = Math.max(0, snapshot.splitIndex);
  const start = Math.max(0, Math.min(current - 1, Math.max(0, splits.length - maxRows)));
  const end = Math.min(splits.length, start + maxRows);

  return splits.slice(start, end).map((split, offset) => {
    const index = start + offset;
    const isCurrent = isCurrentRow(snapshot, index, splits.length);
    return {
      name: split.name || `Split ${index + 1}`,
      time: formatSplitTime(rowTime(snapshot, split, isCurrent, timeMs)),
      pb: formatSplitTime(split.pbMs),
      current: isCurrent,
      color: isCurrent ? (gold ? COLORS.bestSegment : COLORS.highlight) : COLORS.white,
    };
  });
}

function isCurrentRow(snapshot: RunSnapshot, index: number, count: number): boolean {
  if (snapshot.phase === 'NotRunning') {
    return false;
  }
  if (snapshot.phase === 'Ended') {
    return index === count - 1;
  }
  return index === snapshot.splitIndex;
}

function rowTime(
  snapshot: RunSnapshot,
  split: SplitInfo,
  isCurrent: boolean,
  timeMs: number,
): number | null {
  if (isCurrent && (snapshot.phase === 'Running' || snapshot.phase === 'Paused')) {
    return timeMs;
  }
  if (split.runMs !== null) {
    return split.runMs;
  }
  if (isCurrent && snapshot.phase === 'Ended') {
    return timeMs;
  }
  return null;
}

function ledForEvent(event: RunEvent): string | null {
  if (event === 'split' || event === 'start') {
    return COLORS.ledSplit;
  }
  if (event === 'reset') {
    return COLORS.ledReset;
  }
  if (event === 'pb') {
    return COLORS.ledPb;
  }
  return null;
}
