import type { DisplayType, SegLight } from '../type.js';
import { arc, bar, disc, light, path, placeEncoder, poly, range } from './kit.js';

// A Cistercian quadrant's five strokes, drawn for the units (top right of a stem at x = 6 from
// y = 1 to 17): top, low, down from the stem's top, up to the corner, and the far vertical.
const QUADRANT = {
  t: [6, 1, 11, 1],
  l: [6, 6, 11, 6],
  d: [6, 1, 11, 6],
  u: [6, 6, 11, 1],
  v: [11, 1, 11, 6],
} as const;
// Units, tens mirrored left, hundreds flipped below, thousands both.
const PLACES = [
  ['u', 1, 1],
  ['t', -1, 1],
  ['h', 1, -1],
  ['k', -1, -1],
] as const;
const CISTERCIAN_DIGITS = ['', 't', 'l', 'd', 'u', 'u t', 'v', 't v', 'l v', 't l v'];

/** Cistercian numerals: 0 to 9999 in one glyph, a quadrant of a stem per decimal place. */
export const cistercian: DisplayType = {
  name: 'cistercian',
  cell: {
    width: 12,
    height: 18,
    lights: [
      light('stem', bar(6, 1, 6, 17, 1)),
      ...PLACES.flatMap(([q, fx, fy]) =>
        Object.entries(QUADRANT).map(([s, [x1, y1, x2, y2]]) =>
          light(
            `${q}-${s}`,
            bar(6 + (x1 - 6) * fx, 9 + (y1 - 9) * fy, 6 + (x2 - 6) * fx, 9 + (y2 - 9) * fy, 1),
          ),
        ),
      ),
    ],
  },
  gap: 2,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'right',
  encode: placeEncoder(10000, (n) => [
    'stem',
    ...PLACES.flatMap(([q], i) => {
      const strokes = CISTERCIAN_DIGITS[Math.floor(n / 10 ** i) % 10] as string;
      return strokes ? strokes.split(' ').map((s) => `${q}-${s}`) : [];
    }),
  ]),
};

/** Maya numerals: base 20, dots for ones over bars for fives, a shell for zero. */
export const maya: DisplayType = {
  name: 'maya',
  cell: {
    width: 12,
    height: 18,
    lights: [
      ...range(4).map((i) => light(`d${i}`, disc(2.4 + i * 2.4, 2.5, 0.9))),
      // b0 is the bottom bar; bars stack upward as fives are added.
      ...range(3).map((i) => light(`b${i}`, bar(1.5, 15.5 - i * 4, 10.5, 15.5 - i * 4, 1.8))),
      light(
        'shell',
        poly(arc(6, 10, 4.5, 2.6, 0, 360), 0.8),
        poly(arc(6, 12.6, 3.6, 2.6, 225, 315), 0.6),
        poly(arc(6, 7.4, 3.6, 2.6, 45, 135), 0.6),
      ),
    ],
  },
  gap: 1,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'right',
  encode: placeEncoder(20, (d) =>
    d === 0
      ? ['shell']
      : [...range(d % 5).map((i) => `d${i}`), ...range(Math.floor(d / 5)).map((i) => `b${i}`)],
  ),
};

// The fives zigzag right and left upward from the bottom left of their band, and the ones zigzag
// down and up from the same corner, as the Iñupiaq digits join them.
const FIVES: readonly (readonly [number, number, number, number])[] = [
  [1.5, 7, 10.5, 5],
  [10.5, 5, 1.5, 3],
  [1.5, 3, 10.5, 1],
];
const ONES: readonly (readonly [number, number, number, number])[] = [
  [1.5, 7, 3.75, 17],
  [3.75, 17, 6, 7],
  [6, 7, 8.25, 17],
  [8.25, 17, 10.5, 7],
];

/** Kaktovik (Iñupiaq) numerals: base 20, strokes for fives over a zigzag of ones. */
export const kaktovik: DisplayType = {
  name: 'kaktovik',
  cell: {
    width: 12,
    height: 18,
    lights: [
      ...FIVES.map(([x1, y1, x2, y2], i) => light(`f${i}`, bar(x1, y1, x2, y2, 1.1))),
      ...ONES.map(([x1, y1, x2, y2], i) => light(`s${i}`, bar(x1, y1, x2, y2, 1.1))),
      // Zero is a crossed loop hanging below a V.
      light(
        'zero',
        poly(
          path(
            [
              [2, 7.5],
              [7.3, 13.6],
            ],
            arc(6, 15.1, 1.9, 1.9, -40, 220),
            [[10, 7.5]],
          ),
          1.1,
        ),
      ),
    ],
  },
  gap: 1,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'right',
  encode: placeEncoder(20, (d) =>
    d === 0
      ? ['zero']
      : [...range(Math.floor(d / 5)).map((i) => `f${i}`), ...range(d % 5).map((i) => `s${i}`)],
  ),
};

const RODS: SegLight[] = [
  // Upright: up to five standing rods, a crossbar above them worth five.
  ...range(5).map((i) => light(`r${i}`, bar(2 + i * 2, 6.5, 2 + i * 2, 16.5, 1))),
  light('top', bar(1.5, 3.5, 10.5, 3.5, 1)),
  // Lying: up to five lying rods, a standing rod above them worth five.
  ...range(5).map((i) => light(`h${i}`, bar(1.5, 16.5 - i * 2.4, 10.5, 16.5 - i * 2.4, 1))),
  light('v', bar(6, 1, 6, 5.5, 1)),
];

/** Chinese counting rods: units and hundreds stand upright, tens and thousands lie down. */
export const rods: DisplayType = {
  name: 'rods',
  cell: { width: 12, height: 18, lights: RODS },
  gap: 1,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'right',
  encode: placeEncoder(10, (d, place) => {
    const [one, five] = place % 2 === 0 ? ['r', 'top'] : ['h', 'v'];
    const ones = (k: number) => range(k).map((i) => `${one}${i}`);
    return d > 5 ? [five, ...ones(d - 5)] : ones(d);
  }),
};
