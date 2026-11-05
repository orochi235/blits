import { type DisplayType, fitCells, textEncoder } from '../type.js';
import { bar, blanks, count, disc, light, range } from './kit.js';

const digitTable = (lit: (d: number) => string) =>
  Object.fromEntries(range(10).map((d) => [String(d), lit(d)]));

const PIPS = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br'];
const DICE = [
  '',
  'c',
  'tr bl',
  'tr c bl',
  'tl tr bl br',
  'tl tr c bl br',
  'tl ml bl tr mr br',
  'tl ml bl tr mr br c',
  'tl tc tr ml mr bl bc br',
  'tl tc tr ml c mr bl bc br',
];

/** Dice pips: a digit per cell, 0 to 9 on a three-by-three grid of pips. */
export const dice: DisplayType = {
  name: 'dice',
  cell: {
    width: 12,
    height: 12,
    lights: PIPS.map((p, i) => light(p, disc(3 + (i % 3) * 3, 3 + Math.floor(i / 3) * 3, 1.1))),
  },
  gap: 2,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'right',
  encode: textEncoder(digitTable((d) => DICE[d] as string)),
};

/** Tally marks: gates of four strokes and a slash, a gate per cell, the last one partly drawn. */
export const tally: DisplayType = {
  name: 'tally',
  cell: {
    width: 12,
    height: 18,
    lights: [
      ...range(4).map((i) => light(`s${i}`, bar(2.5 + i * 2.33, 2, 2.5 + i * 2.33, 16, 1))),
      light('slash', bar(1, 13, 11, 5, 1)),
    ],
  },
  gap: 2,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'right',
  encode(value, cells, align) {
    const n = count(value);
    if (n === undefined) return blanks(cells);
    const gates = range(Math.ceil(n / 5)).map((g) => {
      const k = Math.min(5, n - g * 5);
      return new Set([...range(Math.min(4, k)).map((i) => `s${i}`), ...(k === 5 ? ['slash'] : [])]);
    });
    return fitCells(gates, cells, align, new Set<string>());
  },
};

const BITS = [8, 4, 2, 1];

/** Binary-coded decimal: a column of four lamps, worth 8, 4, 2 and 1, per digit. */
export const bcd: DisplayType = {
  name: 'bcd',
  cell: {
    width: 6,
    height: 18,
    lights: BITS.map((b, i) => light(String(b), disc(3, 3 + i * 4, 1.2))),
  },
  gap: 1,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'right',
  encode: textEncoder(
    digitTable((d) =>
      BITS.filter((b) => d & b)
        .map(String)
        .join(' '),
    ),
  ),
};

/**
 * A bar graph: a bar per cell, lit from the left for a level from 0 to 1. Every cell has one
 * full-height bar, since cells share a shape.
 */
export const bargraph: DisplayType = {
  name: 'bargraph',
  cell: { width: 2, height: 18, lights: [light('bar', bar(1, 1, 1, 17, 1.4))] },
  gap: 0.5,
  ends: 'square',
  socket: 'segment',
  glow: 1,
  align: 'left',
  encode(value, cells) {
    const v = typeof value === 'number' ? value : value.trim() === '' ? Number.NaN : Number(value);
    if (!Number.isFinite(v)) return blanks(cells);
    const lit = Math.round(Math.min(1, Math.max(0, v)) * cells);
    return range(cells).map((i) => new Set(i < lit ? ['bar'] : []));
  },
};
