import type { RunEvent } from './events.js';

export const FLASH_MS = 450;

/** Keeps an LED colour on screen for a moment after the event that caused it. */
export class FlashWindow {
  private event: RunEvent = null;
  private until = 0;

  constructor(private readonly durationMs = FLASH_MS) {}

  trigger(event: RunEvent, nowMs: number): void {
    if (event === null) {
      return;
    }
    this.event = event;
    this.until = nowMs + this.durationMs;
  }

  active(nowMs: number): RunEvent {
    return nowMs < this.until ? this.event : null;
  }
}
