export const FRONT = {
  width: 72,
  height: 16,
  timeX: 36,
  timeY: 0,
  splitY: 11,
  /** Five glyphs wide: the longest delta the formatter can produce. */
  deltaWidth: 20,
} as const;

const BACK_HEIGHT = 80;
const BACK_FIRST_ROW_Y = 16;
const BACK_ROW_HEIGHT = 12;

export const BACK = {
  width: 160,
  height: BACK_HEIGHT,
  headerY: 2,
  firstRowY: BACK_FIRST_ROW_Y,
  rowHeight: BACK_ROW_HEIGHT,
  maxRows: Math.floor((BACK_HEIGHT - BACK_FIRST_ROW_Y) / BACK_ROW_HEIGHT),
  markX: 2,
  nameX: 8,
  nameWidth: 74,
  timeX: 84,
  pbX: 122,
} as const;

export type BarFont = 'tiny' | 'small' | 'bold';

/**
 * Upper bound per glyph. The device fonts may be narrower, so clipping is
 * conservative: text can come out shorter than strictly necessary, never wider
 * than its box.
 */
export const FONT_WIDTH: Record<BarFont, number> = {
  tiny: 4,
  small: 4,
  bold: 8,
};

export function textWidth(text: string, font: BarFont): number {
  return text.length * FONT_WIDTH[font];
}

export function clipToWidth(text: string, widthPx: number, font: BarFont): string {
  const maxChars = Math.max(1, Math.floor(widthPx / FONT_WIDTH[font]));
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 2) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 2)}..`;
}

export function rowY(index: number): number {
  return BACK.firstRowY + index * BACK.rowHeight;
}
