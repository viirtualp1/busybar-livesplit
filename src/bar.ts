import { BusyBar, type DisplayDrawParams } from '@busy-app/busy-lib';
import { config } from './config.js';
import type { TimerFrame } from './format.js';

const APP_NAME = 'livesplit';

export function createBusyBar(): BusyBar {
  return new BusyBar({
    addr: config.busyAddr,
    timeout: 5000,
    ...(config.busyToken ? { token: config.busyToken } : {}),
    ...(config.busyHttpPassword
      ? { HTTPAccessPassword: config.busyHttpPassword }
      : {}),
  });
}

export class BarDisplay {
  private drawing = false;
  private queued: TimerFrame | null = null;
  private lastKey = '';
  private warnedPriority = false;

  constructor(private readonly bar: BusyBar) {}

  async ping(): Promise<void> {
    await this.bar.SystemStatusGet();
  }

  async push(frame: TimerFrame): Promise<void> {
    const key = `${frame.timeText}|${frame.subText}|${frame.timeColor}|${frame.subColor}`;
    if (key === this.lastKey) {
      return;
    }

    this.queued = frame;
    if (this.drawing) {
      return;
    }

    this.drawing = true;
    try {
      while (this.queued) {
        const next = this.queued;
        this.queued = null;
        await this.draw(next);
        this.lastKey = `${next.timeText}|${next.subText}|${next.timeColor}|${next.subColor}`;
      }
    } finally {
      this.drawing = false;
    }
  }

  async clear(): Promise<void> {
    this.lastKey = '';
    this.queued = null;
    await this.bar.DisplayClear({ application_name: APP_NAME });
  }

  private async draw(frame: TimerFrame): Promise<void> {
    const payload: DisplayDrawParams = {
      application_name: APP_NAME,
      priority: config.drawPriority,
      elements: [
        {
          id: 'time',
          type: 'text',
          text: frame.timeText,
          font: 'large',
          color: frame.timeColor,
          display: 'front',
          align: 'top_mid',
          x: 36,
          y: 0,
          timeout: 0,
        },
        {
          id: 'sub',
          type: 'text',
          text: frame.subText,
          font: 'small',
          color: frame.subColor,
          display: 'front',
          align: 'bottom_left',
          x: 1,
          y: 15,
          width: 70,
          scroll_rate: 800,
          timeout: 0,
        },
      ],
    };

    try {
      await this.bar.DisplayDraw(payload);
      this.warnedPriority = false;
    } catch (error) {
      if (isLowPriority(error)) {
        if (!this.warnedPriority) {
          console.warn(
            'BUSY Bar is showing a higher-priority app (BUSY/CUSTOM session). Waiting…',
          );
          this.warnedPriority = true;
        }
        return;
      }
      throw error;
    }
  }
}

function isLowPriority(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const status = 'status' in error ? Number(error.status) : NaN;
  const message = 'message' in error ? String(error.message) : '';
  const body =
    'body' in error && error.body && typeof error.body === 'object'
      ? error.body
      : null;
  const bodyError =
    body && 'error' in body ? String((body as { error?: unknown }).error) : '';

  return (
    status === 409 ||
    /low priority/i.test(message) ||
    /low priority/i.test(bodyError)
  );
}
