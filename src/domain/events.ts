import type { RunSnapshot, TimerPhase } from '../livesplit/types.js';

export type RunEvent = 'start' | 'split' | 'reset' | 'pb' | null;

export type EventState = {
  phase: TimerPhase | null;
  splitIndex: number | null;
};

export const initialEventState: EventState = { phase: null, splitIndex: null };

export type EventResult = {
  event: RunEvent;
  state: EventState;
};

export function detectEvent(previous: EventState, snapshot: RunSnapshot): EventResult {
  const state: EventState = { phase: snapshot.phase, splitIndex: snapshot.splitIndex };
  return { event: classify(previous, snapshot), state };
}

function classify(previous: EventState, snapshot: RunSnapshot): RunEvent {
  const { phase: prevPhase, splitIndex: prevIndex } = previous;

  if (prevPhase === null) {
    return null;
  }
  if (prevPhase === 'NotRunning' && snapshot.phase === 'Running') {
    return 'start';
  }
  if (prevPhase !== 'NotRunning' && snapshot.phase === 'NotRunning') {
    return 'reset';
  }
  if (snapshot.phase === 'Ended' && prevPhase !== 'Ended') {
    return isPersonalBest(snapshot) ? 'pb' : 'split';
  }
  if (
    (snapshot.phase === 'Running' || snapshot.phase === 'Paused') &&
    prevIndex !== null &&
    prevIndex >= 0 &&
    snapshot.splitIndex > prevIndex
  ) {
    return 'split';
  }
  return null;
}

/** No comparison at all also counts, so a first completed run is still a PB. */
export function isPersonalBest(snapshot: RunSnapshot): boolean {
  const delta = snapshot.liveDeltaMs ?? snapshot.lastDeltaMs;
  return delta === null || delta < 0;
}
