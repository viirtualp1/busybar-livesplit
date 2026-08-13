import type { LiveSplitState, SplitInfo, TimerPhase } from './livesplit.js';

export const COLORS = {
  white: '#FFFFFFFF',
  aheadGaining: '#36CC00FF',
  aheadLosing: '#7FD161FF',
  behindGaining: '#D16161FF',
  behindLosing: '#CC0000FF',
  personalBest: '#14A5FFFF',
  bestSegment: '#FFD400FF',
  notRunning: '#ABABABFF',
  paused: '#7A7A7AFF',
  highlight: '#2B7FFFFF',
} as const;

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

export type FlashKind = 'split' | 'reset' | 'pb' | 'start' | null;

export function buildFrame(state: LiveSplitState, flash: FlashKind = null): TimerFrame {
  const timeText = formatTimer(state.timeMs, state.phase);
  const timeColor = timerColor(state);
  const deltaMs = displayedDelta(state);
  const deltaText = deltaMs === null ? '' : formatDeltaCompact(deltaMs);
  const deltaColor = state.isGold ? COLORS.bestSegment : timeColor;
  const attemptText = `#${state.attemptCount}`;

  const base = {
    timeText,
    attemptText,
    deltaText,
    timeColor,
    deltaColor,
    ledColor: ledForFlash(flash),
    backHeader: attemptText,
    backRows: buildBackRows(state),
  };

  if (state.phase === 'NotRunning') {
    return {
      ...base,
      splitText: 'READY',
      splitColor: COLORS.notRunning,
      timeColor: COLORS.notRunning,
      deltaColor: COLORS.notRunning,
    };
  }

  if (state.phase === 'Paused') {
    return {
      ...base,
      splitText: state.splitName || 'PAUSED',
      splitColor: COLORS.paused,
    };
  }

  if (state.phase === 'Ended') {
    return {
      ...base,
      splitText: state.splitName || 'DONE',
      splitColor: timeColor,
    };
  }

  return {
    ...base,
    splitText: state.splitName || 'RUNNING',
    splitColor: COLORS.white,
  };
}

export function formatTimer(ms: number, phase: TimerPhase): string {
  const abs = Math.max(0, Math.abs(ms));
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  const hundredths = Math.floor((abs % 1000) / 10);

  if (phase === 'NotRunning' && abs === 0) {
    return '0:00.00';
  }

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
  }

  return `${minutes}:${pad(seconds)}.${pad(hundredths)}`;
}

export function formatSplitTime(ms: number | null): string {
  if (ms === null) {
    return '--';
  }
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  const tenths = Math.floor((abs % 1000) / 100);
  if (minutes > 0) {
    return `${minutes}:${pad(seconds)}`;
  }
  return `${seconds}.${tenths}`;
}

function displayedDelta(state: LiveSplitState): number | null {
  if (state.phase === 'NotRunning') {
    return null;
  }

  if (state.phase === 'Ended') {
    return state.liveDeltaMs ?? state.lastDeltaMs;
  }

  const live = state.liveDeltaMs;
  const last = state.lastDeltaMs;
  if (live === null) {
    return last;
  }
  if (live > 0 || (last !== null && live > last)) {
    return live;
  }
  return last;
}

function formatDeltaCompact(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  const tenths = Math.floor((abs % 1000) / 100);

  if (minutes > 0) {
    return `${sign}${minutes}:${pad(seconds)}`;
  }

  return `${sign}${seconds}.${tenths}`;
}

function timerColor(state: LiveSplitState): string {
  if (state.phase === 'NotRunning') {
    return COLORS.notRunning;
  }

  if (state.phase === 'Ended') {
    if (state.liveDeltaMs === null || state.liveDeltaMs < 0) {
      return COLORS.personalBest;
    }
    return COLORS.behindLosing;
  }

  return splitColor(state.liveDeltaMs, state.lastDeltaMs);
}

function splitColor(liveDeltaMs: number | null, lastDeltaMs: number | null): string {
  if (liveDeltaMs === null || liveDeltaMs === 0) {
    return COLORS.aheadGaining;
  }

  if (liveDeltaMs < 0) {
    if (lastDeltaMs !== null && liveDeltaMs > lastDeltaMs) {
      return COLORS.aheadLosing;
    }
    return COLORS.aheadGaining;
  }

  if (lastDeltaMs !== null && liveDeltaMs < lastDeltaMs) {
    return COLORS.behindGaining;
  }

  return COLORS.behindLosing;
}

function buildBackRows(state: LiveSplitState): BackRow[] {
  const splits = state.splits;
  if (splits.length === 0) {
    return [];
  }

  const current = Math.max(0, state.splitIndex);
  const visible = 5;
  const start = Math.max(
    0,
    Math.min(current - 1, Math.max(0, splits.length - visible)),
  );
  const end = Math.min(splits.length, start + visible);

  return splits.slice(start, end).map((split, offset) => {
    const index = start + offset;
    const isCurrent =
      state.phase !== 'NotRunning' &&
      (state.phase === 'Ended'
        ? index === splits.length - 1
        : index === state.splitIndex);
    return {
      name: split.name || `Split ${index + 1}`,
      time: formatSplitTime(rowTime(state, split, isCurrent)),
      pb: formatSplitTime(split.pbMs),
      current: isCurrent,
      color: isCurrent
        ? state.isGold
          ? COLORS.bestSegment
          : COLORS.highlight
        : COLORS.white,
    };
  });
}

function rowTime(
  state: LiveSplitState,
  split: SplitInfo,
  isCurrent: boolean,
): number | null {
  if (isCurrent && (state.phase === 'Running' || state.phase === 'Paused')) {
    return state.timeMs;
  }
  if (split.runMs !== null) {
    return split.runMs;
  }
  if (isCurrent && state.phase === 'Ended') {
    return state.timeMs;
  }
  return null;
}

function ledForFlash(flash: FlashKind): string | null {
  if (flash === 'split' || flash === 'start') {
    return '#FFFFFFFF';
  }
  if (flash === 'reset') {
    return '#FF453AFF';
  }
  if (flash === 'pb') {
    return '#14A5FFFF';
  }
  return null;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
