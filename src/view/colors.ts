import { BASE_COLORS } from 'busybar-kit/colors';

export const COLORS = {
  ...BASE_COLORS,
  aheadGaining: '#36CC00FF',
  aheadLosing: '#7FD161FF',
  behindGaining: '#D16161FF',
  behindLosing: '#CC0000FF',
  personalBest: '#14A5FFFF',
  bestSegment: '#FFD400FF',
  notRunning: '#ABABABFF',
  paused: '#7A7A7AFF',
  highlight: '#2B7FFFFF',
  attempt: '#8A8A8AFF',
  ledSplit: '#FFFFFFFF',
  ledReset: '#FF453AFF',
  ledPb: '#14A5FFFF',
} as const;
