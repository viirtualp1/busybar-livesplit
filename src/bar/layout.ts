import {
  BACK as DEVICE_BACK,
  FRONT as DEVICE_FRONT,
  backRowGrid,
  clipToWidth as clip,
  rowY as gridRowY,
  type BarFont,
} from 'busybar-kit/device';

export { FONT_WIDTH, textWidth, type BarFont } from 'busybar-kit/device';

export const FRONT = {
  ...DEVICE_FRONT,
  timeX: 36,
  timeY: 0,
  splitY: 11,
  /** Five glyphs wide: the longest delta the formatter can produce. */
  deltaWidth: 20,
} as const;

export const BACK = {
  ...DEVICE_BACK,
  // No sub-header here, so the split rows start higher than on the Dota apps.
  ...backRowGrid(16),
  markX: 2,
  nameX: 8,
  nameWidth: 74,
  timeX: 84,
  pbX: 122,
} as const;

/** Split names are long and get cut often, so the mark is a visible `..`. */
export function clipToWidth(text: string, widthPx: number, font: BarFont): string {
  return clip(text, widthPx, font, '..');
}

export function rowY(index: number): number {
  return gridRowY(index, BACK);
}
