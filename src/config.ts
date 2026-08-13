import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveSplitProtocol } from './livesplit/types.js';

export type Config = {
  busyAddr: string;
  isCloud: boolean;
  isUsb: boolean;
  busyToken: string;
  busyHttpPassword: string;
  drawPriority: number;
  liveSplitHost: string;
  liveSplitPort: number;
  liveSplitProtocol: LiveSplitProtocol;
  pollMs: number;
  frameMs: number;
};

export type LoadedConfig = {
  config: Config;
  warnings: string[];
};

export const DEFAULTS = {
  usbAddr: '10.0.4.20',
  cloudAddr: 'https://api.busy.app',
  liveSplitHost: '127.0.0.1',
  liveSplitPort: 16834,
  pollMs: 250,
  frameMs: 60,
  drawPriority: 40,
} as const;

const LIMITS = {
  pollMs: { min: 40, max: 5000 },
  frameMs: { min: 30, max: 1000 },
  drawPriority: { min: 0, max: 100 },
  liveSplitPort: { min: 1, max: 65_535 },
} as const;

export function loadEnvFile(cwd = process.cwd()): void {
  const path = resolve(cwd, '.env');
  if (!existsSync(path)) {
    return;
  }
  // Real environment variables win over the file, same as `node --env-file`.
  process.loadEnvFile(path);
}

export function isCloudAddr(addr: string): boolean {
  return /api(?:\.(?:dev|test|stage))?\.busy\.app/i.test(addr);
}

export function isUsbAddr(addr: string): boolean {
  try {
    const url = /^https?:\/\//i.test(addr) ? new URL(addr) : new URL(`http://${addr}`);
    return url.hostname === DEFAULTS.usbAddr;
  } catch {
    return addr.includes(DEFAULTS.usbAddr);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const warnings: string[] = [];

  const read = (name: string): string => env[name]?.trim() ?? '';

  const number = (
    name: string,
    fallback: number,
    limits: { min: number; max: number },
  ): number => {
    const raw = read(name);
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      warnings.push(`${name}=${raw} is not a number, using ${fallback}`);
      return fallback;
    }
    const clamped = Math.min(limits.max, Math.max(limits.min, Math.round(value)));
    if (clamped !== value) {
      warnings.push(
        `${name}=${raw} is out of range ${limits.min}..${limits.max}, using ${clamped}`,
      );
    }
    return clamped;
  };

  const token = read('BUSY_TOKEN');
  const httpPassword = read('BUSY_HTTP_PASSWORD');
  const busyAddr = read('BUSY_ADDR') || (token ? DEFAULTS.cloudAddr : DEFAULTS.usbAddr);
  const cloud = isCloudAddr(busyAddr);
  const usb = isUsbAddr(busyAddr);

  if (cloud && httpPassword) {
    warnings.push('BUSY_HTTP_PASSWORD is ignored on cloud, only BUSY_TOKEN is used');
  }
  if (!cloud && token) {
    warnings.push(
      `BUSY_TOKEN is ignored for ${busyAddr}, that token only works on cloud`,
    );
  }
  if (usb && httpPassword) {
    warnings.push('BUSY_HTTP_PASSWORD is ignored over USB, no auth is required there');
  }
  if (!cloud && !usb && !httpPassword) {
    warnings.push(
      'Wi-Fi needs BUSY_HTTP_PASSWORD (Bar web UI → Network → HTTP API access)',
    );
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
      busyAddr,
      isCloud: cloud,
      isUsb: usb,
      busyToken: cloud ? token : '',
      busyHttpPassword: cloud || usb ? '' : httpPassword,
      drawPriority: number('DRAW_PRIORITY', DEFAULTS.drawPriority, LIMITS.drawPriority),
      liveSplitHost: read('LIVESPLIT_HOST') || DEFAULTS.liveSplitHost,
      liveSplitPort: number(
        'LIVESPLIT_PORT',
        DEFAULTS.liveSplitPort,
        LIMITS.liveSplitPort,
      ),
      liveSplitProtocol: protocol,
      pollMs: number('POLL_MS', DEFAULTS.pollMs, LIMITS.pollMs),
      frameMs: number('FRAME_MS', DEFAULTS.frameMs, LIMITS.frameMs),
    },
  };
}
