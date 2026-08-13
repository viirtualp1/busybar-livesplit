export type BarInput =
  | { kind: 'ok' }
  | { kind: 'back' }
  | { kind: 'start' }
  | { kind: 'encoder'; delta: number };

type InputHandler = (event: BarInput) => void;

export class BarInputListener {
  private ws: WebSocket | null = null;
  private stopped = false;
  private lastOk = 0;
  private lastBack = 0;

  constructor(
    private readonly url: string | null,
    private readonly onInput: InputHandler,
  ) {}

  start(): void {
    if (!this.url) {
      console.warn(
        'Bar buttons need USB/Wi-Fi (not cloud). Set BUSY_ADDR to the device IP to use the wheel.',
      );
      return;
    }
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connect();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Bar input reconnecting: ${reason}`);
        await sleep(2000);
      }
    }
  }

  private connect(): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(new Error('WebSocket is not available'));
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url ?? '');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Bar input websocket timeout'));
      }, 4000);

      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        console.log('Bar input connected (start = reset, wheel = start/pause)');
      });

      ws.addEventListener('message', (event) => {
        void this.handleMessage(event.data);
      });

      ws.addEventListener('close', () => {
        clearTimeout(timeout);
        if (this.ws === ws) {
          this.ws = null;
        }
        resolve();
      });

      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Bar input websocket error'));
      });
    });
  }

  private dispatch(input: BarInput): void {
    const now = Date.now();
    if (input.kind === 'ok') {
      if (now - this.lastOk < 180) {
        return;
      }
      this.lastOk = now;
    }
    if (input.kind === 'back' || input.kind === 'start') {
      if (now - this.lastBack < 400) {
        return;
      }
      this.lastBack = now;
    }
    console.log(`Bar ${input.kind}`);
    this.onInput(input);
  }

  private async handleMessage(data: unknown): Promise<void> {
    const bytes = await toBytes(data);
    if (!bytes) {
      return;
    }
    for (const input of decodeInputs(bytes)) {
      this.dispatch(input);
    }
  }
}

export function barInputUrl(
  addr: string,
  httpPassword: string,
  token: string,
): string | null {
  const trimmed = addr.trim();
  if (/api(?:\.(?:dev|test|stage))?\.busy\.app/i.test(trimmed)) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withProtocol);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/status/ws';
  url.search = '';
  if (httpPassword) {
    url.searchParams.set('x-api-token', httpPassword);
  } else if (token) {
    url.searchParams.set('x-api-token', token);
  }
  return url.toString();
}

function toBytes(data: unknown): Promise<Uint8Array | null> | Uint8Array | null {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return null;
}

function decodeInputs(bytes: Uint8Array): BarInput[] {
  const events: BarInput[] = [];
  walk(bytes, (field, wire, payload) => {
    if (field === 2 && wire === 2) {
      walk(payload, (uField, uWire, uPayload) => {
        if (uField === 11 && uWire === 2) {
          const parsed = parseInputEvent(uPayload);
          if (parsed) {
            events.push(parsed);
          }
        }
      });
    }
  });
  return events;
}

function parseInputEvent(bytes: Uint8Array): BarInput | null {
  let button: number | null = null;
  let action: number | null = null;
  let encoder: number | null = null;

  walk(bytes, (field, wire, payload) => {
    if (field === 1 && wire === 2) {
      walk(payload, (bField, bWire, bPayload) => {
        if (bWire !== 0) {
          return;
        }
        const value = readVarintFrom(bPayload);
        if (bField === 1) {
          button = value;
        }
        if (bField === 2) {
          action = value;
        }
      });
    }
    if (field === 3 && wire === 2) {
      walk(payload, (eField, eWire, ePayload) => {
        if (eField === 1 && eWire === 0) {
          encoder = zigzag(readVarintFrom(ePayload));
        }
      });
    }
  });

  if (encoder !== null && encoder !== 0) {
    return { kind: 'encoder', delta: encoder };
  }
  if (button === null) {
    return null;
  }
  if (action !== null && action !== 0) {
    return null;
  }
  if (button === 0) {
    return { kind: 'ok' };
  }
  if (button === 1) {
    return { kind: 'back' };
  }
  if (button === 2) {
    return { kind: 'start' };
  }
  return null;
}

function walk(
  bytes: Uint8Array,
  visit: (field: number, wire: number, payload: Uint8Array) => void,
): void {
  let i = 0;
  while (i < bytes.length) {
    const tag = readVarint(bytes, i);
    i = tag.next;
    const field = tag.value >>> 3;
    const wire = tag.value & 7;
    if (wire === 0) {
      const start = i;
      const value = readVarint(bytes, i);
      i = value.next;
      visit(field, wire, bytes.subarray(start, i));
    } else if (wire === 1) {
      visit(field, wire, bytes.subarray(i, i + 8));
      i += 8;
    } else if (wire === 2) {
      const len = readVarint(bytes, i);
      i = len.next;
      visit(field, wire, bytes.subarray(i, i + len.value));
      i += len.value;
    } else if (wire === 5) {
      visit(field, wire, bytes.subarray(i, i + 4));
      i += 4;
    } else {
      break;
    }
  }
}

function readVarint(bytes: Uint8Array, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = start;
  while (i < bytes.length) {
    const byte = bytes[i] ?? 0;
    i += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }
  return { value, next: i };
}

function readVarintFrom(bytes: Uint8Array): number {
  return readVarint(bytes, 0).value;
}

function zigzag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
