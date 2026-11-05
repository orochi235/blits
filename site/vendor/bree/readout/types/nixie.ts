import { type DisplayType, textEncoder } from '../type.js';
import { arc, curve, light, type Point, path, poly } from './kit.js';

const W = 0.7;

// Numerals in a 12 × 20 cell, drawn as an IN-14's cathodes: upright, rounded, 2 to 18 tall.
const one = path(
  [
    [4.4, 3.8],
    [6, 2],
  ],
  [[6, 18]],
);

const two = path(arc(6, 5.6, 3.5, 3.6, 195, 385), [
  [2.6, 18],
  [9.6, 18],
]);

const three = path(arc(6, 5.9, 3.2, 3.9, 205, 450), arc(6, 13.9, 3.6, 4.1, 270, 515));

const four = path([
  [8, 18],
  [8, 2],
  [2.4, 13],
  [10, 13],
]);

const five = path(
  [
    [9.4, 2],
    [3, 2],
  ],
  arc(6, 13.3, 3.6, 4.7, 220, 510),
);

const six = path(arc(9.6, 12.5, 7.1, 10.2, 255, 180), arc(6, 13.4, 3.5, 4.6, 180, -180));

const seven = path(
  [
    [2.6, 2],
    [9.6, 2],
  ],
  curve([9.6, 2], [7, 8.5], [5, 18]),
);

const eight = path(arc(6, 5.85, 3, 3.85, 90, 450), arc(6, 13.85, 3.6, 4.15, -90, -450));

const turned = (ps: readonly Point[]): Point[] => ps.map(([x, y]) => [12 - x, 20 - y] as const);

const zero = arc(6, 10, 3.6, 8, 0, 360);

const NUMERALS: Record<string, Point[]> = {
  '0': zero,
  '1': one,
  '2': two,
  '3': three,
  '4': four,
  '5': five,
  '6': six,
  '7': seven,
  '8': eight,
  '9': turned(six),
};

// Back to front, as an IN-14 stacks them.
const STACK = ['1', '6', '2', '7', '5', '0', '4', '9', '8', '3'];

/** A Nixie tube: ten numeral cathodes stacked in one cell, one glowing at a time. */
export const nixie: DisplayType = {
  name: 'nixie',
  cell: {
    width: 12,
    height: 20,
    lights: STACK.map((d) => light(d, poly(NUMERALS[d] as Point[], W))),
  },
  gap: 1.5,
  ends: 'round',
  socket: 'wire',
  glow: 2.5,
  align: 'right',
  encode: textEncoder(Object.fromEntries(STACK.map((d) => [d, d]))),
};
