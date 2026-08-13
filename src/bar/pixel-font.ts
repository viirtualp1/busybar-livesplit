/** The smallest device font is still too tall for the attempt counter, so digits are drawn as rectangles. */
export const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 5;
export const GLYPH_ADVANCE = GLYPH_WIDTH + 1;

/** Fixed element count keeps ids stable, so shrinking numbers cannot leave pixels behind. */
export const MAX_ATTEMPT_DIGITS = 5;
export const RUNS_PER_ROW = 2;

export const PIXEL_DIGITS: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

export type PixelRun = { x: number; width: number };

export function rowRuns(row: string | undefined): PixelRun[] {
  if (!row) {
    return [];
  }
  const runs: PixelRun[] = [];
  let start = -1;
  for (let x = 0; x <= row.length; x += 1) {
    const on = x < row.length && row[x] === '1';
    if (on && start < 0) {
      start = x;
    }
    if (!on && start >= 0) {
      runs.push({ x: start, width: x - start });
      start = -1;
    }
  }
  return runs;
}
