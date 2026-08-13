import { BarDisplay, createBusyBar } from './bar.js';
import { config } from './config.js';
import { buildFrame } from './format.js';
import { LiveSplitClient } from './livesplit.js';

const livesplit = new LiveSplitClient(
  config.liveSplitHost,
  config.liveSplitPort,
  config.liveSplitProtocol,
);
const bar = createBusyBar();
const display = new BarDisplay(bar);

let running = true;
let lastPhase = '';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectLiveSplit(): Promise<void> {
  while (running && !livesplit.connected) {
    try {
      await livesplit.connect();
      console.log(
        `LiveSplit connected (${livesplit.activeProtocol} ${config.liveSplitHost}:${config.liveSplitPort})`,
      );
    } catch {
      console.warn(
        `Waiting for LiveSplit Server at ${config.liveSplitHost}:${config.liveSplitPort}…`,
      );
      await sleep(1500);
    }
  }
}

async function connectBar(): Promise<void> {
  while (running) {
    try {
      await display.ping();
      console.log(`BUSY Bar connected (${config.busyAddr})`);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Waiting for BUSY Bar at ${config.busyAddr}: ${reason}`);
      await sleep(2000);
    }
  }
}

async function loop(): Promise<void> {
  while (running) {
    try {
      if (!livesplit.connected) {
        await connectLiveSplit();
        if (!running) {
          return;
        }
      }

      const state = await livesplit.getState();
      if (state.phase !== lastPhase) {
        lastPhase = state.phase;
        console.log(
          `[${state.phase}] ${buildFrame(state).timeText}` +
            (state.splitName ? `  ${state.splitName}` : ''),
        );
      }

      await display.push(buildFrame(state));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(reason);
      livesplit.disconnect();
      await sleep(1500);
    }

    await sleep(config.pollMs);
  }
}

async function shutdown(): Promise<void> {
  if (!running) {
    return;
  }
  running = false;
  livesplit.disconnect();
  try {
    await display.clear();
  } catch {
    // device may already be gone
  }
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

console.log('LiveSplit → BUSY Bar');
console.log(
  'In LiveSplit: right click → Control → Start TCP Server (port 16834)',
);

await connectBar();
await connectLiveSplit();
await loop();
