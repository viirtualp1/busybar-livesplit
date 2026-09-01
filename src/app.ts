import { BACK } from './bar/layout.js';
import type { BarDisplay } from './bar/display.js';
import { errorMessage, isForbidden } from 'busybar-kit/errors';
import type { Config } from './config.js';
import { detectEvent, initialEventState, type EventState } from './domain/events.js';
import { FlashWindow } from './domain/flash.js';
import type { LiveSplitConnection } from './livesplit/connection.js';
import type { RunTracker } from './livesplit/tracker.js';
import { emptySnapshot, type RunSnapshot } from './livesplit/types.js';
import { buildFrame } from './view/frame.js';
import { formatTimer } from './view/time.js';

export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type AppDeps = {
  config: Config;
  connection: LiveSplitConnection;
  tracker: RunTracker;
  display: BarDisplay;
  logger?: Logger;
};

const RECONNECT_MS = 1500;
const BAR_RETRY_MS = 2000;
const REPEAT_WARNING_MS = 10_000;

export class App {
  private readonly config: Config;
  private readonly connection: LiveSplitConnection;
  private readonly tracker: RunTracker;
  private readonly display: BarDisplay;
  private readonly logger: Logger;
  private readonly flash = new FlashWindow();

  private snapshot: RunSnapshot = emptySnapshot(0);
  private events: EventState = initialEventState;
  private running = false;
  private loops: Promise<void>[] = [];
  private warnings = new Map<string, { message: string; at: number }>();

  constructor(deps: AppDeps) {
    this.config = deps.config;
    this.connection = deps.connection;
    this.tracker = deps.tracker;
    this.display = deps.display;
    this.logger = deps.logger ?? console;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.connectBar();
    if (!this.running) {
      return;
    }
    this.loops = [this.pollLoop(), this.renderLoop()];
  }

  async wait(): Promise<void> {
    await Promise.all(this.loops);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.connection.disconnect('shutting down');
    await Promise.allSettled(this.loops);
    try {
      await this.display.clear();
    } catch {
      // the device may already be gone
    }
  }

  private async connectBar(): Promise<void> {
    while (this.running) {
      try {
        await this.display.ping();
        this.logger.info(`BUSY Bar connected (${this.config.busyAddr})`);
        this.display.markStale();
        return;
      } catch (error) {
        const hint =
          isForbidden(error) && !this.config.isCloud
            ? ' — set BUSY_HTTP_PASSWORD to the HTTP Access password, leave BUSY_TOKEN empty'
            : '';
        this.warnRepeated(
          'bar',
          `Waiting for BUSY Bar at ${this.config.busyAddr}: ${errorMessage(error)}${hint}`,
        );
        await this.sleep(BAR_RETRY_MS);
      }
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        if (!this.connection.connected) {
          await this.connection.connect();
          this.tracker.reset();
          this.events = initialEventState;
          this.logger.info(
            `LiveSplit connected (${this.connection.activeProtocol} ${this.config.liveSplitHost}:${this.config.liveSplitPort})`,
          );
        }

        this.snapshot = await this.tracker.poll();
        this.handleEvents();
      } catch (error) {
        this.connection.disconnect(errorMessage(error));
        this.warnRepeated(
          'livesplit',
          `LiveSplit: ${errorMessage(error)} (retrying at ${this.config.liveSplitHost}:${this.config.liveSplitPort})`,
        );
        await this.sleep(RECONNECT_MS);
        continue;
      }

      await this.sleep(this.config.pollMs);
    }
  }

  private handleEvents(): void {
    const { event, state } = detectEvent(this.events, this.snapshot);
    this.events = state;
    if (event === null) {
      return;
    }

    this.flash.trigger(event, this.now());
    this.logger.info(
      `[${event}] ${formatTimer(this.snapshot.timeMs)}` +
        (this.snapshot.splitName ? `  ${this.snapshot.splitName}` : ''),
    );

    if (event !== 'split') {
      void this.display.playEvent(event).catch(() => {
        // sound is cosmetic
      });
    }
  }

  /** Display failures must not take the LiveSplit connection down with them. */
  private async renderLoop(): Promise<void> {
    while (this.running) {
      const now = this.now();
      try {
        await this.display.push(
          buildFrame(this.snapshot, {
            nowMs: now,
            maxRows: BACK.maxRows,
            flash: this.flash.active(now),
          }),
        );
      } catch (error) {
        this.warnRepeated('draw', `BUSY Bar draw failed: ${errorMessage(error)}`);
      }

      await this.sleep(this.config.frameMs);
    }
  }

  private warnRepeated(key: string, message: string): void {
    const now = this.now();
    const previous = this.warnings.get(key);
    if (
      previous &&
      previous.message === message &&
      now - previous.at < REPEAT_WARNING_MS
    ) {
      return;
    }
    this.warnings.set(key, { message, at: now });
    this.logger.warn(message);
  }

  private now(): number {
    return performance.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
