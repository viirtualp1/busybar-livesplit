#!/usr/bin/env node
import { App } from './app.js';
import { BarDisplay, createBusyBar } from './bar/display.js';
import { errorMessage } from './bar/errors.js';
import { loadConfig, loadEnvFile } from './config.js';
import { LiveSplitConnection } from './livesplit/connection.js';
import { SplitsCatalog } from './livesplit/splits-source.js';
import { RunTracker } from './livesplit/tracker.js';

loadEnvFile();
const { config, warnings } = loadConfig();

console.log('busybar-livesplit');
console.log('LiveSplit: right click → Control → Start TCP Server (port 16834)');
for (const warning of warnings) {
  console.warn(warning);
}

const connection = new LiveSplitConnection(
  config.liveSplitHost,
  config.liveSplitPort,
  config.liveSplitProtocol,
);
const bar = createBusyBar({
  addr: config.busyAddr,
  token: config.busyToken,
  httpPassword: config.busyHttpPassword,
});
const app = new App({
  config,
  connection,
  tracker: new RunTracker(connection, {
    catalog: new SplitsCatalog(config.splitsFile),
  }),
  display: new BarDisplay(bar, config.drawPriority),
});

let exiting = false;
async function shutdown(code: number): Promise<void> {
  if (exiting) {
    return;
  }
  exiting = true;
  await app.stop();
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('unhandledRejection', (reason) => {
  console.warn(`Unhandled rejection: ${errorMessage(reason)}`);
});
process.on('uncaughtException', (error) => {
  console.error(`Fatal: ${errorMessage(error)}`);
  void shutdown(1);
});

await app.start();
await app.wait();
