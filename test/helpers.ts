import { emptySnapshot, type RunSnapshot } from '../src/livesplit/types.js';

export function makeSnapshot(partial: Partial<RunSnapshot> = {}): RunSnapshot {
  return { ...emptySnapshot(0), ...partial };
}

export function makeSplits(count: number): RunSnapshot['splits'] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Split ${i + 1}`,
    pbMs: null,
    runMs: null,
  }));
}
