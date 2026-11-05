import { STANDARD } from '../../glyphs/standard.js';
import { type DisplayType, textEncoder } from '../type.js';
import { disc, light } from './kit.js';

const COLS = 5;
const ROWS = 7;

const lights = Array.from({ length: COLS * ROWS }, (_, i) => {
  const [x, y] = [i % COLS, Math.floor(i / COLS)];
  return light(`${x},${y}`, disc(1 + x * 2, 1 + y * 2, 0.8));
});

const table = Object.fromEntries(
  Object.entries(STANDARD).map(([ch, rows]) => [
    ch,
    rows
      .flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `${x},${y}` : '')))
      .filter(Boolean)
      .join(' '),
  ]),
);

/** A 5 × 7 dot matrix per character, in bree's standard face. */
export const matrix: DisplayType = {
  name: 'matrix',
  cell: { width: COLS * 2, height: ROWS * 2, lights },
  gap: 1,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'left',
  encode: textEncoder(table),
};
