import { type DisplayType, type SegLight, textEncoder } from '../type.js';
import { FOURTEEN, SIXTEEN, TWENTYTWO } from './alpha-glyphs.js';
import { bar, DP, light, RING } from './bars.js';

// Lights: a–f the outer ring clockwise from the top, g1 g2 the middle bar's halves, h i j the
// upper diagonal, vertical and diagonal left to right, k l m the lower ones; split bars' halves
// (a1 a2, d1 d2, q1 q2) number left to right.

const STAR: readonly SegLight[] = [
  light('g1', bar(2, 9, 4.4, 9)),
  light('g2', bar(5.6, 9, 8, 9)),
  light('h', bar(2.2, 2.4, 4.4, 7.6)),
  light('i', bar(5, 2, 5, 8)),
  light('j', bar(7.8, 2.4, 5.6, 7.6)),
  light('k', bar(4.4, 10.4, 2.2, 15.6)),
  light('l', bar(5, 10, 5, 16)),
  light('m', bar(5.6, 10.4, 7.8, 15.6)),
];

const SPLIT_RING: readonly SegLight[] = [
  light('a1', bar(2, 1, 4.4, 1)),
  light('a2', bar(5.6, 1, 8, 1)),
  ...RING.filter((l) => l.name !== 'a' && l.name !== 'd'),
  light('d1', bar(2, 17, 4.4, 17)),
  light('d2', bar(5.6, 17, 8, 17)),
];

/** n o p hang from the baseline left to right, q1 q2 floor them, r hooks down to the left. */
const DESCENDER: readonly SegLight[] = [
  light('n', bar(1, 18, 1, 22)),
  light('o', bar(5, 18, 5, 22)),
  light('p', bar(9, 18, 9, 22)),
  light('q1', bar(2, 23, 4.4, 23)),
  light('q2', bar(5.6, 23, 8, 23)),
  light('r', bar(4.4, 18.4, 2.2, 22.6)),
];

const family = {
  gap: 2.5,
  ends: 'point',
  socket: 'segment',
  glow: 1,
  align: 'left',
} as const;

/** The 14-segment alphanumeric, with a decimal point and comma: the pinball plasma display. */
export const fourteen: DisplayType = {
  name: 'fourteen',
  cell: {
    width: 10,
    height: 18,
    lights: [...RING, ...STAR, DP, light('comma', bar(10.6, 18.4, 9.8, 20, 1.2))],
  },
  ...family,
  encode: textEncoder(FOURTEEN, { dp: 'dp', comma: 'comma' }),
};

/** The 16-segment starburst: 14 segments with the top and bottom bars split. */
export const sixteen: DisplayType = {
  name: 'sixteen',
  cell: { width: 10, height: 18, lights: [...SPLIT_RING, ...STAR, DP] },
  ...family,
  encode: textEncoder(SIXTEEN, { dp: 'dp' }),
};

/** The 22-segment display: a starburst over a descender, for upper and lower case. */
export const twentytwo: DisplayType = {
  name: 'twentytwo',
  cell: { width: 10, height: 24, lights: [...SPLIT_RING, ...STAR, ...DESCENDER, DP] },
  ...family,
  encode: textEncoder(TWENTYTWO, { dp: 'dp' }),
};
