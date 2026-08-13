import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function envString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseProtocol(value: string): 'auto' | 'tcp' | 'ws' {
  if (value === 'tcp' || value === 'ws') {
    return value;
  }
  return 'auto';
}

loadEnvFile(resolve(process.cwd(), '.env'));

function isCloudAddr(addr: string): boolean {
  return /api(?:\.(?:dev|test|stage))?\.busy\.app/i.test(addr);
}

function isUsbAddr(addr: string): boolean {
  try {
    const url = /^https?:\/\//i.test(addr) ? new URL(addr) : new URL(`http://${addr}`);
    return url.hostname === '10.0.4.20';
  } catch {
    return addr.includes('10.0.4.20');
  }
}

const token = process.env.BUSY_TOKEN?.trim() || '';
const httpPassword = process.env.BUSY_HTTP_PASSWORD?.trim() || '';
const busyAddr = envString(
  'BUSY_ADDR',
  token ? 'https://api.busy.app' : '10.0.4.20',
);
const cloud = isCloudAddr(busyAddr);

export const config = {
  busyAddr,
  isCloud: cloud,
  isUsb: isUsbAddr(busyAddr),
  busyToken: cloud ? token : '',
  busyHttpPassword: cloud || isUsbAddr(busyAddr) ? '' : httpPassword,
  liveSplitHost: envString('LIVESPLIT_HOST', '127.0.0.1'),
  liveSplitPort: envNumber('LIVESPLIT_PORT', 16834),
  liveSplitProtocol: parseProtocol(envString('LIVESPLIT_PROTOCOL', 'auto')),
  pollMs: envNumber('POLL_MS', 80),
  drawPriority: envNumber('DRAW_PRIORITY', 40),
};
