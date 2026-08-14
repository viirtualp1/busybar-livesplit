import { readFile, stat } from 'node:fs/promises';
import { parseLiveSplitTime, sanitizeSplitName } from './types.js';

/**
 * Which of the two clocks a stored time belongs to. LiveSplit keeps both in the
 * file and shows whichever the run was last timed with.
 */
export type TimingMethod = 'real' | 'game';

export type SplitsFileSegment = {
  name: string;
  /** Cumulative Personal Best time, empty until the run has been completed once. */
  pbMs: number | null;
  bestSegmentMs: number | null;
};

export type SplitsFileRun = {
  path: string;
  gameName: string;
  categoryName: string;
  attemptCount: number | null;
  segments: SplitsFileSegment[];
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXml(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code: string) => {
    if (!code.startsWith('#')) {
      return ENTITIES[code.toLowerCase()] ?? match;
    }
    const hex = code[1]?.toLowerCase() === 'x';
    const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : match;
  });
}

/**
 * The interesting parts of a splits file are shallow and uniquely named, while
 * the bulk of it is attempt and segment history nobody here reads. Pulling the
 * few tags out by name keeps the whole thing dependency free.
 */
function block(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match === null ? null : (match[1] ?? '');
}

function tagText(xml: string, tag: string): string | null {
  const inner = block(xml, tag);
  return inner === null ? null : decodeXml(inner).trim();
}

function timeIn(xml: string | null, method: TimingMethod): number | null {
  if (!xml) {
    return null;
  }
  const preferred = method === 'game' ? 'GameTime' : 'RealTime';
  const fallback = method === 'game' ? 'RealTime' : 'GameTime';
  const raw = tagText(xml, preferred) ?? tagText(xml, fallback);
  if (raw !== null) {
    return parseLiveSplitTime(raw);
  }
  const plain = xml.trim();
  return plain.includes('<') ? null : parseLiveSplitTime(plain);
}

function personalBestXml(splitTimes: string): string | null {
  const pattern = /<SplitTime\b([^>]*)(?:\/>|>([\s\S]*?)<\/SplitTime>)/g;
  let first: string | null = null;
  for (const match of splitTimes.matchAll(pattern)) {
    const inner = match[2] ?? '';
    if (first === null) {
      first = inner;
    }
    if (/name\s*=\s*["']Personal Best["']/i.test(match[1] ?? '')) {
      return inner;
    }
  }
  return first;
}

function fillPbFromGolds(segments: SplitsFileSegment[]): void {
  if (segments.some((segment) => segment.pbMs !== null)) {
    return;
  }
  let cumulative = 0;
  for (const segment of segments) {
    if (segment.bestSegmentMs === null) {
      return;
    }
    cumulative += segment.bestSegmentMs;
    segment.pbMs = cumulative;
  }
}

const SEGMENT = /<Segment>([\s\S]*?)<\/Segment>/g;

export function parseSplitsFile(
  xml: string,
  method: TimingMethod,
  path = '',
): SplitsFileRun | null {
  const segmentsXml = block(xml, 'Segments');
  if (segmentsXml === null) {
    return null;
  }

  const segments: SplitsFileSegment[] = [];
  for (const match of segmentsXml.matchAll(SEGMENT)) {
    const segment = match[1] ?? '';
    const splitTimes = block(segment, 'SplitTimes');
    segments.push({
      name: sanitizeSplitName(tagText(segment, 'Name') ?? ''),
      pbMs: timeIn(splitTimes === null ? null : personalBestXml(splitTimes), method),
      bestSegmentMs: timeIn(block(segment, 'BestSegmentTime'), method),
    });
  }

  if (segments.length === 0) {
    return null;
  }

  fillPbFromGolds(segments);

  const attempts = Number.parseInt(tagText(xml, 'AttemptCount') ?? '', 10);
  return {
    path,
    gameName: tagText(xml, 'GameName') ?? '',
    categoryName: tagText(xml, 'CategoryName') ?? '',
    attemptCount: Number.isFinite(attempts) && attempts >= 0 ? attempts : null,
    segments,
  };
}

export function decodeTextFile(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.toString('utf16le');
  }
  if (bytes.length >= 4 && bytes[0] !== 0 && bytes[1] === 0 && bytes[3] === 0) {
    return bytes.toString('utf16le');
  }
  return bytes.toString('utf8');
}

export async function readSplitsFile(
  path: string,
  method: TimingMethod,
): Promise<SplitsFileRun | null> {
  return parseSplitsFile(decodeTextFile(await readFile(path)), method, path);
}

export async function modifiedAt(path: string): Promise<number> {
  return (await stat(path)).mtimeMs;
}
