import { BarDisplay, createBusyBar } from './bar.js';
import { config } from './config.js';
import { buildFrame, type FlashKind } from './format.js';
import { BarInputListener, barInputUrl, type BarInput } from './input.js';
import { LiveSplitClient, type LiveSplitState } from './livesplit.js';

const livesplit = new LiveSplitClient(
  config.liveSplitHost,
  config.liveSplitPort,
  config.liveSplitProtocol,
);
const bar = createBusyBar();
const display = new BarDisplay(bar);
const input = new BarInputListener(
  barInputUrl(config.busyAddr, config.busyHttpPassword, config.busyToken),
  onBarInput,
);

let running = true;
let lastPhase = '';
let lastSplitIndex = -2;
let flash: FlashKind = null;
let flashUntil = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function triggerFlash(kind: FlashKind): void {
  flash = kind;
  flashUntil = Date.now() + 450;
}

function onBarInput(event: BarInput): void {
  if (!livesplit.connected) {
    console.warn(`Bar ${event.kind} ignored: LiveSplit is not connected`);
    return;
  }
  if (event.kind === 'ok') {
    if (lastPhase === 'Paused') {
      livesplit.resume();
    } else if (lastPhase === 'Running') {
      livesplit.pause();
    } else {
      livesplit.startTimer();
    }
    return;
  }
  if (event.kind === 'back') {
    display.forceRedraw();
    return;
  }
  if (event.kind === 'start') {
    livesplit.reset();
  }
}

function detectEvents(state: LiveSplitState): FlashKind {
  const prevPhase = lastPhase;
  const prevIndex = lastSplitIndex;
  lastPhase = state.phase;
  lastSplitIndex = state.splitIndex;

  if (prevPhase === 'NotRunning' && state.phase === 'Running') {
    return 'start';
  }
  if (
    prevPhase !== '' &&
    prevPhase !== 'NotRunning' &&
    state.phase === 'NotRunning'
  ) {
    return 'reset';
  }
  if (state.phase === 'Ended' && prevPhase !== 'Ended') {
    if (state.liveDeltaMs === null || state.liveDeltaMs < 0) {
      return 'pb';
    }
    return 'split';
  }
  if (
    (state.phase === 'Running' || state.phase === 'Paused') &&
    prevIndex >= 0 &&
    state.splitIndex > prevIndex
  ) {
    return 'split';
  }
  return null;
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
  if (!config.isCloud && !config.isUsb && !config.busyHttpPassword) {
    console.warn(
      'Wi-Fi needs BUSY_HTTP_PASSWORD (Bar web UI → Network → HTTP API access). Cloud BUSY_TOKEN will not work here.',
    );
  }

  while (running) {
    try {
      await display.ping();
      console.log(`BUSY Bar connected (${config.busyAddr})`);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const hint =
        /forbidden/i.test(reason) && !config.isCloud
          ? ' — set BUSY_HTTP_PASSWORD to the HTTP Access password, leave BUSY_TOKEN empty'
          : '';
      console.warn(
        `Waiting for BUSY Bar at ${config.busyAddr}: ${reason}${hint}`,
      );
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
      const event = detectEvents(state);
      if (event) {
        console.log(
          `[${state.phase}] ${buildFrame(state).timeText}` +
            (state.splitName ? `  ${state.splitName}` : ''),
        );
        triggerFlash(event);
        if (event === 'start' || event === 'reset' || event === 'pb') {
          void display.playEvent(event);
        }
      }

      const activeFlash = Date.now() < flashUntil ? flash : null;
      await display.push(buildFrame(state, activeFlash));
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
  input.stop();
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

console.log('busybar-livesplit');
console.log(
  'LiveSplit: right click → Control → Start TCP Server (port 16834)',
);
console.log(
  'Bar: start = reset, wheel click = start/pause/resume (Back closes overlay — ignored)',
);

await connectBar();
input.start();
await connectLiveSplit();
await loop();
