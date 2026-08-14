import type { RectangleElement, TextElement } from '@busy-app/busy-lib';
import { COLORS } from '../view/colors.js';
import type { TimerFrame } from '../view/frame.js';
import { BACK, clipToWidth, FRONT, rowY } from './layout.js';
import {
  GLYPH_ADVANCE,
  GLYPH_HEIGHT,
  MAX_ATTEMPT_DIGITS,
  PIXEL_DIGITS,
  RUNS_PER_ROW,
  rowRuns,
} from './pixel-font.js';

export function frontElements(frame: TimerFrame): Array<TextElement | RectangleElement> {
  const hasDelta = frame.deltaText.length > 0;
  const splitAreaWidth = FRONT.width - (hasDelta ? FRONT.deltaWidth : 0);

  return [
    {
      id: 'time',
      type: 'text',
      text: frame.timeText,
      font: 'bold',
      color: frame.timeColor,
      display: 'front',
      align: 'top_mid',
      x: FRONT.timeX,
      y: FRONT.timeY,
      timeout: 0,
    },
    ...attemptElements(frame.attemptText),
    {
      id: 'split',
      type: 'text',
      text: clipToWidth(frame.splitText || ' ', splitAreaWidth, 'tiny'),
      font: 'tiny',
      color: frame.splitColor,
      display: 'front',
      align: 'top_mid',
      x: Math.floor(splitAreaWidth / 2),
      y: FRONT.splitY,
      width: splitAreaWidth,
      timeout: 0,
    },
    {
      id: 'delta',
      type: 'text',
      text: hasDelta ? clipToWidth(frame.deltaText, FRONT.deltaWidth, 'tiny') : ' ',
      font: 'tiny',
      color: hasDelta ? frame.deltaColor : COLORS.transparent,
      display: 'front',
      align: 'top_right',
      x: FRONT.width - 1,
      y: FRONT.splitY,
      width: FRONT.deltaWidth,
      timeout: 0,
    },
  ];
}

export function attemptElements(text: string): RectangleElement[] {
  const digits = (text.replace(/\D/g, '') || '0').slice(0, MAX_ATTEMPT_DIGITS);
  const elements: RectangleElement[] = [];

  for (let digit = 0; digit < MAX_ATTEMPT_DIGITS; digit += 1) {
    const glyph = PIXEL_DIGITS[digits[digit] ?? ''];
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const runs = rowRuns(glyph?.[row]);
      for (let slot = 0; slot < RUNS_PER_ROW; slot += 1) {
        const run = runs[slot];
        elements.push(
          pixelRect(
            `att-${digit}-${row}-${slot}`,
            run ? digit * GLYPH_ADVANCE + run.x : 0,
            run ? row : 0,
            run ? run.width : 1,
            run ? COLORS.attempt : COLORS.transparent,
          ),
        );
      }
    }
  }

  return elements;
}

function pixelRect(
  id: string,
  x: number,
  y: number,
  width: number,
  color: string,
): RectangleElement {
  return {
    id,
    type: 'rectangle',
    display: 'front',
    align: 'top_left',
    x,
    y,
    width,
    height: 1,
    fill: 'solid',
    fill_colors: [color],
    border_width: 0,
    border_color: COLORS.transparent,
    timeout: 0,
  };
}

export function backElements(frame: TimerFrame): TextElement[] {
  const elements: TextElement[] = [
    {
      id: 'back-header',
      type: 'text',
      text: frame.backHeader,
      font: 'small',
      color: COLORS.muted,
      display: 'back',
      align: 'top_left',
      x: BACK.markX,
      y: BACK.headerY,
      timeout: 0,
    },
    {
      id: 'back-header-pb',
      type: 'text',
      text: 'BEST',
      font: 'tiny',
      color: COLORS.white,
      display: 'back',
      align: 'top_left',
      x: BACK.pbX,
      y: BACK.headerY,
      timeout: 0,
    },
  ];

  for (let i = 0; i < BACK.maxRows; i += 1) {
    const row = frame.backRows[i];
    const y = rowY(i);
    const color = row?.color ?? COLORS.transparent;

    elements.push(
      {
        id: `b${i}-mark`,
        type: 'text',
        text: row?.current ? '>' : ' ',
        font: 'tiny',
        color,
        display: 'back',
        align: 'top_left',
        x: BACK.markX,
        y,
        timeout: 0,
      },
      {
        id: `b${i}-name`,
        type: 'text',
        text: row ? clipToWidth(row.name, BACK.nameWidth, 'tiny') : ' ',
        font: 'tiny',
        color,
        display: 'back',
        align: 'top_left',
        x: BACK.nameX,
        y,
        width: BACK.nameWidth,
        timeout: 0,
      },
      {
        id: `b${i}-time`,
        type: 'text',
        text: row?.time ?? ' ',
        font: 'tiny',
        color,
        display: 'back',
        align: 'top_left',
        x: BACK.timeX,
        y,
        timeout: 0,
      },
      {
        id: `b${i}-pb`,
        type: 'text',
        text: row?.pb ?? ' ',
        font: 'tiny',
        color: row ? COLORS.white : COLORS.transparent,
        display: 'back',
        align: 'top_left',
        x: BACK.pbX,
        y,
        timeout: 0,
      },
    );
  }

  return elements;
}
