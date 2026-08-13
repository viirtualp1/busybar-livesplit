import { BusyBar, type DisplayDrawParams, type TextElement } from '@busy-app/busy-lib';
import { config } from './config.js';
import type { TimerFrame } from './format.js';

const APP_NAME = 'livesplit';
const FRONT_WIDTH = 72;
const BACK_WIDTH = 160;
const SPLIT_Y = 11;
const ATTEMPT_WIDTH = 16;
const DELTA_WIDTH = 16;
const TINY_CHAR_WIDTH = 3;
const SMALL_CHAR_WIDTH = 4;

const SOUNDS = {
  start: ['shared/volume_change.snd', 'shared/volume_change.wav'],
  reset: ['shared/volume_change.snd', 'shared/volume_change.wav'],
  pb: [
    'shared/calendar_event_starts.snd',
    'shared/calendar_event_starts.wav',
    'shared/volume_change.snd',
  ],
} as const;

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
  private lastFrame: TimerFrame | null = null;
  private lastKey = '';
  private holdUntil = 0;
  private warnedPriority = false;
  private clearedStale = false;
  private failedSounds = new Set<string>();

  constructor(private readonly bar: BusyBar) {}

  async ping(): Promise<void> {
    await this.bar.SystemStatusGet();
  }

  forceRedraw(): void {
    this.lastKey = '';
    this.holdUntil = Date.now() + 500;
    if (this.lastFrame) {
      void this.push(this.lastFrame);
    }
  }

  async push(frame: TimerFrame): Promise<void> {
    this.lastFrame = frame;
    const key = frameKey(frame);
    if (key === this.lastKey && Date.now() >= this.holdUntil) {
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

  async playEvent(kind: 'start' | 'reset' | 'pb'): Promise<void> {
    await this.playStock(SOUNDS[kind]);
  }

  async clear(): Promise<void> {
    this.lastKey = '';
    this.queued = null;
    this.clearedStale = false;
    await this.bar.DisplayClear({ application_name: APP_NAME });
  }

  private async playStock(names: readonly string[]): Promise<void> {
    for (const name of names) {
      if (this.failedSounds.has(name)) {
        continue;
      }
      try {
        await this.bar.AudioPlay({
          application_name: APP_NAME,
          stock_path: name,
        });
        return;
      } catch (error) {
        if (isClientError(error)) {
          this.failedSounds.add(name);
          continue;
        }
        return;
      }
    }
  }

  private async draw(frame: TimerFrame): Promise<void> {
    if (!this.clearedStale) {
      await this.bar.DisplayClear({ application_name: APP_NAME });
      this.clearedStale = true;
    }

    const hasDelta = frame.deltaText.length > 0;
    const splitAreaLeft = ATTEMPT_WIDTH;
    const splitAreaWidth = FRONT_WIDTH - ATTEMPT_WIDTH - (hasDelta ? DELTA_WIDTH : 0);
    const splitX = splitAreaLeft + Math.floor(splitAreaWidth / 2);

    const payload: DisplayDrawParams = {
      application_name: APP_NAME,
      priority: config.drawPriority,
      ...(frame.ledColor ? { led_notification_color: frame.ledColor } : {}),
      elements: [
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
          id: 'attempt',
          type: 'text',
          text: frame.attemptText,
          font: 'tiny',
          color: frame.splitColor,
          display: 'front',
          align: 'top_left',
          x: 1,
          y: SPLIT_Y,
          timeout: 0,
        },
        {
          id: 'split',
          type: 'text',
          text: clipText(frame.splitText || ' ', splitAreaWidth, TINY_CHAR_WIDTH),
          font: 'tiny',
          color: frame.splitColor,
          display: 'front',
          align: 'top_mid',
          x: splitX,
          y: SPLIT_Y,
          width: splitAreaWidth,
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
        ...backElements(frame),
      ],
    };

    try {
      await this.drawRaw(payload);
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

  private async drawRaw(payload: DisplayDrawParams): Promise<void> {
    const client = this.bar.apiClient;
    const { data, error } = await client.execute((signal) =>
      client.POST('/display/draw', {
        body: payload,
        ...(signal ? { signal } : {}),
      }),
    );
    if (error) {
      throw error;
    }
    void data;
  }
}

function backElements(frame: TimerFrame): TextElement[] {
  const elements: TextElement[] = [
    {
      id: 'back-header',
      type: 'text',
      text: frame.backHeader,
      font: 'small',
      color: '#9AA0A6FF',
      display: 'back',
      align: 'top_left',
      x: 2,
      y: 2,
      timeout: 0,
    },
    {
      id: 'back-header-pb',
      type: 'text',
      text: 'PB',
      font: 'small',
      color: '#9AA0A6FF',
      display: 'back',
      align: 'top_right',
      x: BACK_WIDTH - 2,
      y: 2,
      timeout: 0,
    },
  ];

  frame.backRows.forEach((row, i) => {
    const y = 16 + i * 12;
    const nameWidth = 88;
    elements.push(
      {
        id: `b${i}-mark`,
        type: 'text',
        text: row.current ? '>' : ' ',
        font: 'small',
        color: row.color,
        display: 'back',
        align: 'top_left',
        x: 2,
        y,
        timeout: 0,
      },
      {
        id: `b${i}-name`,
        type: 'text',
        text: clipText(row.name, nameWidth, SMALL_CHAR_WIDTH),
        font: 'small',
        color: row.color,
        display: 'back',
        align: 'top_left',
        x: 10,
        y,
        width: nameWidth,
        timeout: 0,
      },
      {
        id: `b${i}-time`,
        type: 'text',
        text: row.time,
        font: 'small',
        color: row.color,
        display: 'back',
        align: 'top_right',
        x: 118,
        y,
        timeout: 0,
      },
      {
        id: `b${i}-pb`,
        type: 'text',
        text: row.pb,
        font: 'small',
        color: '#9AA0A6FF',
        display: 'back',
        align: 'top_right',
        x: BACK_WIDTH - 2,
        y,
        timeout: 0,
      },
    );
  });

  return elements;
}

function frameKey(frame: TimerFrame): string {
  return JSON.stringify([
    frame.timeText,
    frame.splitText,
    frame.deltaText,
    frame.attemptText,
    frame.timeColor,
    frame.splitColor,
    frame.deltaColor,
    frame.ledColor ?? '',
    frame.backHeader,
    frame.backRows,
  ]);
}

function clipText(text: string, widthPx: number, charWidth: number): string {
  const maxChars = Math.max(1, Math.floor(widthPx / charWidth));
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

function isClientError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return false;
  }
  const status = Number(error.status);
  return status >= 400 && status < 500;
}
