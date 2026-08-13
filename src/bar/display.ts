import { BusyBar, type DisplayDrawParams } from '@busy-app/busy-lib';
import type { RunEvent } from '../domain/events.js';
import type { TimerFrame } from '../view/frame.js';
import { backElements, frontElements } from './elements.js';
import { isClientError, isLowPriority, toBarError } from './errors.js';

export const APP_NAME = 'livesplit';

const SOUNDS: Record<'start' | 'reset' | 'pb', readonly string[]> = {
  start: ['shared/volume_change.snd', 'shared/volume_change.wav'],
  reset: ['shared/volume_change.snd', 'shared/volume_change.wav'],
  pb: [
    'shared/calendar_event_starts.snd',
    'shared/calendar_event_starts.wav',
    'shared/volume_change.snd',
  ],
};

export type BarConnection = {
  addr: string;
  token: string;
  httpPassword: string;
  timeoutMs?: number;
};

export function createBusyBar(connection: BarConnection): BusyBar {
  return new BusyBar({
    addr: connection.addr,
    timeout: connection.timeoutMs ?? 5000,
    ...(connection.token ? { token: connection.token } : {}),
    ...(connection.httpPassword ? { HTTPAccessPassword: connection.httpPassword } : {}),
  });
}

export class BarDisplay {
  private drawing = false;
  private stopped = false;
  private queued: TimerFrame | null = null;
  private lastKey = '';
  private cleared = false;
  private warnedPriority = false;
  private failedSounds = new Set<string>();

  constructor(
    private readonly bar: BusyBar,
    private readonly priority: number,
  ) {}

  async ping(): Promise<void> {
    await this.bar.SystemStatusGet();
  }

  /** After a device reboot or a lost connection the screen may hold stale elements. */
  markStale(): void {
    this.cleared = false;
    this.lastKey = '';
  }

  stop(): void {
    this.stopped = true;
    this.queued = null;
  }

  async push(frame: TimerFrame): Promise<void> {
    if (this.stopped) {
      return;
    }

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
      while (this.queued && !this.stopped) {
        const next = this.queued;
        this.queued = null;
        await this.draw(next);
        this.lastKey = frameKey(next);
      }
    } catch (error) {
      this.markStale();
      throw error;
    } finally {
      this.drawing = false;
    }
  }

  async playEvent(event: Exclude<RunEvent, null | 'split'>): Promise<void> {
    const names = SOUNDS[event];
    for (const name of names) {
      if (this.failedSounds.has(name)) {
        continue;
      }
      try {
        await this.bar.AudioPlay({ application_name: APP_NAME, stock_path: name });
        return;
      } catch (error) {
        if (!isClientError(error)) {
          return;
        }
        this.failedSounds.add(name);
      }
    }
  }

  async clear(): Promise<void> {
    this.stop();
    this.lastKey = '';
    this.cleared = false;
    await this.bar.DisplayClear({ application_name: APP_NAME });
  }

  private async draw(frame: TimerFrame): Promise<void> {
    if (!this.cleared) {
      await this.bar.DisplayClear({ application_name: APP_NAME });
      this.cleared = true;
    }

    const payload: DisplayDrawParams = {
      application_name: APP_NAME,
      priority: this.priority,
      ...(frame.ledColor ? { led_notification_color: frame.ledColor } : {}),
      elements: [...frontElements(frame), ...backElements(frame)],
    };

    try {
      await this.drawRaw(payload);
      this.warnedPriority = false;
    } catch (error) {
      if (!isLowPriority(error)) {
        throw error;
      }
      if (!this.warnedPriority) {
        console.warn(
          'BUSY Bar is showing a higher-priority app (BUSY/CUSTOM session). Waiting…',
        );
        this.warnedPriority = true;
      }
    }
  }

  /** The generated DisplayDraw helper drops `led_notification_color`, so the route is called directly. */
  private async drawRaw(payload: DisplayDrawParams): Promise<void> {
    const client = this.bar.apiClient;
    const { error } = await client.execute((signal) =>
      client.POST('/display/draw', {
        body: payload,
        ...(signal ? { signal } : {}),
      }),
    );
    if (error) {
      throw toBarError(error);
    }
  }
}

function frameKey(frame: TimerFrame): string {
  return JSON.stringify(frame);
}
