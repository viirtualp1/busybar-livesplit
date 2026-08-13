import type { LiveSplitState, TimerPhase } from './livesplit.js';

export const COLORS = {
  white: '#FFFFFFFF',
  muted: '#9AA0A6FF',
  ahead: '#32D74BFF',
  behind: '#FF453AFF',
  gold: '#FFD60AFF',
  paused: '#FFD60AFF',
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
  const timeColor = colorForPhase(state.phase, state.deltaMs);
  const deltaText =
    state.deltaMs !== null && state.phase !== 'NotRunning'
      ? formatDelta(state.deltaMs)
      : '';
  const deltaColor = colorForDelta(state.phase, state.deltaMs);

  if (state.phase === 'NotRunning') {
    return {
      timeText,
      deltaText: '',
      splitText: 'READY',
      timeColor: COLORS.muted,
      deltaColor: COLORS.muted,
      splitColor: COLORS.muted,
    };
  }

  if (state.phase === 'Paused') {
    return {
      timeText,
      deltaText,
      splitText: state.splitName || 'PAUSED',
      timeColor: COLORS.paused,
      deltaColor: COLORS.paused,
      splitColor: COLORS.paused,
    };
  }

  if (state.phase === 'Ended') {
    return {
      timeText,
      deltaText,
      splitText: state.splitName || 'DONE',
      timeColor: COLORS.gold,
      deltaColor: COLORS.gold,
      splitColor: COLORS.gold,
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

function colorForPhase(phase: TimerPhase, deltaMs: number | null): string {
  if (phase === 'Ended') {
    return COLORS.gold;
  }
  if (phase === 'Paused') {
    return COLORS.paused;
  }
  if (deltaMs === null || phase === 'NotRunning') {
    return COLORS.white;
  }
  if (deltaMs < 0) {
    return COLORS.ahead;
  }
  if (deltaMs > 0) {
    return COLORS.behind;
  }
  return COLORS.white;
}

function colorForDelta(phase: TimerPhase, deltaMs: number | null): string {
  if (phase === 'Paused') {
    return COLORS.paused;
  }
  return colorForPhase(phase, deltaMs);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
