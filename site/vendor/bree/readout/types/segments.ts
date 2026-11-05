import { type DisplayType, fitCells, type SegLight, textEncoder } from '../type.js';
import { bar, DP, disc, light, RING } from './bars.js';

const SEVEN: Readonly<Record<string, string>> = {
  ' ': '',
  '0': 'a b c d e f',
  '1': 'b c',
  '2': 'a b g e d',
  '3': 'a b g c d',
  '4': 'f g b c',
  '5': 'a f g c d',
  '6': 'a f g e d c',
  '7': 'a b c',
  '8': 'a b c d e f g',
  '9': 'a b c d f g',
  A: 'a b c e f g',
  B: 'c d e f g',
  C: 'a d e f',
  c: 'd e g',
  D: 'b c d e g',
  E: 'a d e f g',
  F: 'a e f g',
  G: 'a c d e f',
  H: 'b c e f g',
  I: 'e f',
  J: 'b c d e',
  L: 'd e f',
  N: 'c e g',
  O: 'a b c d e f',
  o: 'c d e g',
  P: 'a b e f g',
  R: 'e g',
  S: 'a c d f g',
  T: 'd e f g',
  U: 'b c d e f',
  Y: 'b c d f g',
  '-': 'g',
  _: 'd',
  '=': 'd g',
  '°': 'a b f g',
};

const SEVEN_LIGHTS: readonly SegLight[] = [
  ...RING,
  light('g', bar(2, 9, 8, 9)),
  DP,
  light('colon', disc(11.2, 6, 0.7), disc(11.2, 12, 0.7)),
];

const MARKS = { dp: 'dp', colon: 'colon' } as const;

const family = {
  gap: 2.5,
  ends: 'point',
  socket: 'segment',
  glow: 1,
  align: 'right',
} as const;

/** The seven-segment digit, with a decimal point and a colon after each cell. */
export const seven: DisplayType = {
  name: 'seven',
  cell: { width: 10, height: 18, lights: SEVEN_LIGHTS },
  ...family,
  encode: textEncoder(SEVEN, MARKS),
};

/** Seven segments and the diagonal F. W. Wood's 1908 patent draws its 4 with. */
export const eight: DisplayType = {
  name: 'eight',
  cell: {
    width: 10,
    height: 18,
    lights: [...SEVEN_LIGHTS, light('h', bar(8.6, 2.4, 1.4, 8.6))],
  },
  ...family,
  encode: textEncoder({ ...SEVEN, '4': 'h g b c' }, MARKS),
};

/** Seven segments and two diagonals, for a slanted 7, Z and slash. */
export const nine: DisplayType = {
  name: 'nine',
  cell: {
    width: 10,
    height: 18,
    lights: [
      ...SEVEN_LIGHTS,
      light('h', bar(8.6, 2.4, 1.4, 8.6)),
      light('i', bar(8.6, 9.4, 1.4, 15.6)),
    ],
  },
  ...family,
  encode: textEncoder({ ...SEVEN, '7': 'a b i', Z: 'a b i d', '/': 'h i' }, MARKS),
};

const HALF: Readonly<Record<string, readonly string[]>> = {
  '1': ['one'],
  '-': ['minus'],
  '-1': ['minus', 'one'],
};

/** The ½ digit leading a 3½-digit meter: a 1, a minus, both or neither. */
export const half: DisplayType = {
  name: 'half',
  cell: {
    width: 6,
    height: 18,
    lights: [light('one', bar(5, 2, 5, 16)), light('minus', bar(1, 9, 3, 9))],
  },
  ...family,
  encode: (value, cells, align) =>
    fitCells([new Set(HALF[String(value)] ?? [])], cells, align, new Set<string>()),
};
