import type { LiveSplitState, TimerPhase } from './livesplit.js';

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
} as const;

export type TimerFrame = {
  timeText: string;
  deltaText: string;
  splitText: string;
  timeColor: string;
  deltaColor: string;
  splitColor: string;
};

export function buildFrame(state: LiveSplitState): TimerFrame {
  const timeText = formatTimer(state.timeMs, state.phase);
  const timeColor = timerColor(state);
  const deltaMs = state.liveDeltaMs ?? state.lastDeltaMs;
  const deltaText =
    deltaMs !== null && state.phase !== 'NotRunning' ? formatDelta(deltaMs) : '';
  const deltaColor = timeColor;

  if (state.phase === 'NotRunning') {
    return {
      timeText,
      deltaText: '',
      splitText: 'READY',
      timeColor: COLORS.notRunning,
      deltaColor: COLORS.notRunning,
      splitColor: COLORS.notRunning,
    };
  }

  if (state.phase === 'Paused') {
    return {
      timeText,
      deltaText,
      splitText: state.splitName || 'PAUSED',
      timeColor,
      deltaColor,
      splitColor: COLORS.paused,
    };
  }

  if (state.phase === 'Ended') {
    return {
      timeText,
      deltaText,
      splitText: state.splitName || 'DONE',
      timeColor,
      deltaColor,
      splitColor: timeColor,
    };
  }

  return {
    timeText,
    deltaText,
    splitText: state.splitName || 'RUNNING',
    timeColor,
    deltaColor,
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

export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  const hundredths = Math.floor((abs % 1000) / 10);

  if (minutes > 0) {
    return `${sign}${minutes}:${pad(seconds)}.${pad(hundredths)}`;
  }

  return `${sign}${seconds}.${pad(hundredths)}`;
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

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
