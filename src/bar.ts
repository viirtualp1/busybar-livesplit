import { BusyBar, type DisplayDrawParams } from '@busy-app/busy-lib';
import { config } from './config.js';
import type { TimerFrame } from './format.js';

const APP_NAME = 'livesplit';
const FRONT_WIDTH = 72;
const TIMER_HEIGHT = 10;
const SPLIT_Y = 11;
const DELTA_WIDTH = 16;
const SPLIT_WIDTH = FRONT_WIDTH - DELTA_WIDTH;
const TINY_CHAR_WIDTH = 3;

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
  private clearedStale = false;

  constructor(private readonly bar: BusyBar) {}

  async ping(): Promise<void> {
    await this.bar.SystemStatusGet();
  }

  async push(frame: TimerFrame): Promise<void> {
    const key = frameKey(frame);
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
        this.lastKey = frameKey(next);
      }
    } finally {
      this.drawing = false;
    }
  }

  async clear(): Promise<void> {
    this.lastKey = '';
    this.queued = null;
    this.clearedStale = false;
    await this.bar.DisplayClear({ application_name: APP_NAME });
  }

  private async draw(frame: TimerFrame): Promise<void> {
    if (!this.clearedStale) {
      await this.bar.DisplayClear({ application_name: APP_NAME });
      this.clearedStale = true;
    }
    const hasDelta = frame.deltaText.length > 0;
    const splitWidth = hasDelta ? SPLIT_WIDTH : FRONT_WIDTH;
    const splitX = Math.floor(splitWidth / 2);
    const splitText = clipText(frame.splitText || ' ', splitWidth);

    const payload: DisplayDrawParams = {
      application_name: APP_NAME,
      priority: config.drawPriority,
      elements: [
        {
          id: 'mask',
          type: 'rectangle',
          display: 'front',
          align: 'top_left',
          x: 0,
          y: 0,
          width: FRONT_WIDTH,
          height: TIMER_HEIGHT,
          fill: 'solid',
          fill_colors: ['#000000FF'],
          border_width: 0,
          border_color: '#00000000',
          timeout: 0,
        },
        {
          id: 'time',
          type: 'text',
          text: frame.timeText,
          font: 'bold',
          color: frame.timeColor,
          display: 'front',
          align: 'top_mid',
          x: 36,
          y: 0,
          timeout: 0,
        },
        {
          id: 'split',
          type: 'text',
          text: splitText,
          font: 'tiny',
          color: frame.splitColor,
          display: 'front',
          align: 'top_mid',
          x: splitX,
          y: SPLIT_Y,
          width: splitWidth,
          timeout: 0,
        },
        {
          id: 'delta',
          type: 'text',
          text: hasDelta ? frame.deltaText : ' ',
          font: 'tiny',
          color: hasDelta ? frame.deltaColor : '#00000000',
          display: 'front',
          align: 'top_right',
          x: FRONT_WIDTH - 1,
          y: SPLIT_Y,
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

function frameKey(frame: TimerFrame): string {
  return [
    frame.timeText,
    frame.splitText,
    frame.deltaText,
    frame.timeColor,
    frame.splitColor,
    frame.deltaColor,
  ].join('|');
}

function clipText(text: string, widthPx: number): string {
  const maxChars = Math.max(1, Math.floor(widthPx / TINY_CHAR_WIDTH));
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 2) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 2)}..`;
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
