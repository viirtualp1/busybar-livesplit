import { existsSync } from 'node:fs';
import {
  type BarConfig,
  DEFAULTS as BAR_DEFAULTS,
  loadBarConfig,
} from 'busybar-kit/config';
import type { LiveSplitProtocol } from './livesplit/types.js';

export { isCloudAddr, isUsbAddr, loadEnvFile } from 'busybar-kit/config';

export type Config = BarConfig & {
  liveSplitHost: string;
  liveSplitPort: number;
  liveSplitProtocol: LiveSplitProtocol;
  pollMs: number;
  frameMs: number;
  /** Explicit `.lss` path; empty means look at LiveSplit's own recent files. */
  splitsFile: string;
};

export type LoadedConfig = {
  config: Config;
  warnings: string[];
};

export const DEFAULTS = {
  ...BAR_DEFAULTS,
  liveSplitHost: '127.0.0.1',
  liveSplitPort: 16834,
  // A timer showing hundredths has to redraw far more often than a match ticker.
  pollMs: 250,
  frameMs: 60,
} as const;

const LIMITS = {
  pollMs: { min: 40, max: 5000 },
  frameMs: { min: 30, max: 1000 },
  liveSplitPort: { min: 1, max: 65_535 },
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const warnings: string[] = [];
  const { bar, env: reader } = loadBarConfig(env, warnings);
  const { read, number } = reader;

  const splits = read('SPLITS_FILE');
  if (splits && !existsSync(splits)) {
    warnings.push(`SPLITS_FILE=${splits} does not exist, falling back to auto-detection`);
  }

  const protocolRaw = read('LIVESPLIT_PROTOCOL').toLowerCase();
  let protocol: LiveSplitProtocol = 'auto';
  if (protocolRaw === 'tcp' || protocolRaw === 'ws') {
    protocol = protocolRaw;
  } else if (protocolRaw && protocolRaw !== 'auto') {
    warnings.push(`LIVESPLIT_PROTOCOL=${protocolRaw} is unknown, using auto`);
  }

  return {
    warnings,
    config: {
      ...bar,
      liveSplitHost: read('LIVESPLIT_HOST') || DEFAULTS.liveSplitHost,
      liveSplitPort: number(
        'LIVESPLIT_PORT',
        DEFAULTS.liveSplitPort,
        LIMITS.liveSplitPort,
      ),
      liveSplitProtocol: protocol,
      pollMs: number('POLL_MS', DEFAULTS.pollMs, LIMITS.pollMs),
      frameMs: number('FRAME_MS', DEFAULTS.frameMs, LIMITS.frameMs),
      splitsFile: splits,
    },
  };
}
