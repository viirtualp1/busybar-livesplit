import { LiveSplitDesyncError, LiveSplitTimeoutError } from './connection.js';
import { replyValue } from './types.js';

/**
 * Commands the modern built-in server answers but the deprecated LiveSplit.Server
 * component never had. The rest of the protocol is shared by both.
 */
export type ServerFeature = 'splitCount' | 'splitNames' | 'attemptCount' | 'bestSegments';

const PROBES: ReadonlyArray<readonly [ServerFeature, string]> = [
  ['splitCount', 'getsplitcount'],
  ['splitNames', 'getsplitname 0'],
  ['attemptCount', 'getattemptcount'],
  ['bestSegments', 'getcomparisonsplittime Best Segments'],
];

export type ProbeChannel = {
  trySend(command: string): Promise<string | null>;
};

/**
 * Detected once per process, not per connection: the server on the other end
 * does not grow new commands while the app runs, and probing is the only place
 * where a reply may legitimately never arrive.
 */
export class ServerCapabilities {
  private readonly support = new Map<ServerFeature, boolean>();

  supports(feature: ServerFeature): boolean {
    return this.support.get(feature) === true;
  }

  /** Stops using a command that turned out to break the connection. */
  disable(feature: ServerFeature): void {
    this.support.set(feature, false);
  }

  get complete(): boolean {
    return PROBES.every(([feature]) => this.support.has(feature));
  }

  /**
   * A command LiveSplit cannot handle takes its reader thread down with it, so
   * one that leaves the connection dead is written off instead of being retried
   * on every reconnect.
   */
  async detect(channel: ProbeChannel): Promise<void> {
    for (const [feature, command] of PROBES) {
      if (this.support.has(feature)) {
        continue;
      }
      try {
        this.support.set(feature, replyValue(await channel.trySend(command)) !== null);
      } catch (error) {
        if (
          error instanceof LiveSplitTimeoutError ||
          error instanceof LiveSplitDesyncError
        ) {
          this.support.set(feature, false);
        }
        throw error;
      }
    }
  }
}
