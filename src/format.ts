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
  subText: string;
  timeColor: string;
  subColor: string;
};

export function buildFrame(state: LiveSplitState): TimerFrame {
  const timeText = formatTimer(state.timeMs, state.phase);
  const timeColor = colorForPhase(state.phase, state.deltaMs);

  if (state.phase === 'NotRunning') {
    return {
      timeText,
      subText: 'READY',
      timeColor: COLORS.muted,
      subColor: COLORS.muted,
    };
  }

  if (state.phase === 'Paused') {
    return {
      timeText,
      subText: subtitle(state, 'PAUSED'),
      timeColor: COLORS.paused,
      subColor: COLORS.paused,
    };
  }

  if (state.phase === 'Ended') {
    return {
      timeText,
      subText: subtitle(state, 'DONE'),
      timeColor: COLORS.gold,
      subColor: COLORS.gold,
    };
  }

  return {
    timeText,
    subText: subtitle(state, state.splitName || 'RUNNING'),
    timeColor,
    subColor: timeColor,
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

function subtitle(state: LiveSplitState, fallback: string): string {
  const parts: string[] = [];
  if (state.deltaMs !== null && state.phase !== 'NotRunning') {
    parts.push(formatDelta(state.deltaMs));
  }
  if (state.splitName) {
    parts.push(state.splitName);
  } else {
    parts.push(fallback);
  }
  return parts.join(' ');
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

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
