import { type DisplayType, fitCells, textEncoder } from '../type.js';
import { bar, disc, light, range } from './kit.js';

// Grade 1 letters a to j; k to t add dot 3, and u, v, x, y, z add dots 3 and 6.
const BRAILLE_AJ = ['1', '12', '14', '145', '15', '124', '1245', '125', '24', '245'];
const BRAILLE: Record<string, string> = { ' ': '', w: '2456' };
for (const [i, dots] of BRAILLE_AJ.entries()) {
  BRAILLE[String.fromCharCode(97 + i)] = dots;
  BRAILLE[String.fromCharCode(107 + i)] = `${dots}3`;
}
for (const [ch, of] of [
  ['u', 'a'],
  ['v', 'b'],
  ['x', 'c'],
  ['y', 'd'],
  ['z', 'e'],
] as const)
  BRAILLE[ch] = `${BRAILLE[of]}36`;
const NUMBER_SIGN = '3456';
const LETTER_SIGN = '56';
const brailleCell = (dots: string) => new Set([...dots].map((d) => `d${d}`));

/**
 * Grade 1 Braille: a–z, space, and digits after the number sign. A letter a–j straight after a
 * digit takes the letter sign, so it doesn't read as a digit.
 */
export const braille: DisplayType = {
  name: 'braille',
  cell: {
    width: 12,
    height: 18,
    lights: range(6).map((i) => light(`d${i + 1}`, disc(i < 3 ? 3 : 9, 3 + (i % 3) * 6, 1.3))),
  },
  gap: 2,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'left',
  encode(value, cells, align) {
    const out: Set<string>[] = [];
    let numeric = false;
    for (const ch of String(value).toLowerCase()) {
      const digit = '1234567890'.indexOf(ch);
      if (digit >= 0) {
        if (!numeric) out.push(brailleCell(NUMBER_SIGN));
        numeric = true;
        out.push(brailleCell(BRAILLE_AJ[digit] as string));
        continue;
      }
      const dots = BRAILLE[ch];
      if (numeric && dots !== undefined && ch >= 'a' && ch <= 'j')
        out.push(brailleCell(LETTER_SIGN));
      numeric = false;
      out.push(brailleCell(dots ?? ''));
    }
    return fitCells(out, cells, align, new Set<string>());
  },
};

// The four aicmí: strokes right of the stem, left of it, across it, and notches on it.
const OGHAM_GROUPS = [
  ['r', 'BLFSN', 'ᚁᚂᚃᚄᚅ'],
  ['l', 'HDTCQ', 'ᚆᚇᚈᚉᚊ'],
  ['x', 'MG ZR', 'ᚋᚌᚍᚎᚏ'],
  ['n', 'AOUEI', 'ᚐᚑᚒᚓᚔ'],
] as const;
const OGHAM: Record<string, string> = { ' ': 'stem', '\u1680': 'stem' };
for (const [g, latin, native] of OGHAM_GROUPS)
  for (let i = 0; i < 5; i++) {
    const lit = ['stem', ...range(i + 1).map((k) => `${g}${k}`)].join(' ');
    if (latin[i] !== ' ') OGHAM[latin[i] as string] = lit;
    OGHAM[native[i] as string] = lit;
  }
OGHAM.V = OGHAM.F as string;

/**
 * Ogham, drawn along a horizontal stemline: right-hand strokes hang below it, left-hand ones
 * stand above. NG is `ᚍ`, V reads as F, and a space continues the stemline.
 */
export const ogham: DisplayType = {
  name: 'ogham',
  cell: {
    width: 14,
    height: 18,
    lights: [
      light('stem', bar(0.45, 9, 13.55, 9, 0.9)),
      ...range(5).map((i) => light(`r${i}`, bar(2.2 + i * 2.4, 9, 2.2 + i * 2.4, 15.5, 0.9))),
      ...range(5).map((i) => light(`l${i}`, bar(2.2 + i * 2.4, 9, 2.2 + i * 2.4, 2.5, 0.9))),
      ...range(5).map((i) => light(`x${i}`, bar(1 + i * 2.4, 15, 3.4 + i * 2.4, 3, 0.9))),
      ...range(5).map((i) => light(`n${i}`, disc(2.2 + i * 2.4, 9, 0.9))),
    ],
  },
  gap: 0,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'left',
  encode: textEncoder(OGHAM),
};

const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '0': '-----',
  '/': '-..-.',
  '=': '-...-',
  '+': '.-.-.',
  '(': '-.--.',
  '&': '.-...',
};

/** International Morse, a lamp per character: five places, each a dot or a dash. */
export const morse: DisplayType = {
  name: 'morse',
  cell: {
    width: 20,
    height: 6,
    lights: range(5).flatMap((i) => [
      light(`dot${i}`, disc(2 + i * 4, 3, 0.8)),
      light(`dash${i}`, bar(1 + i * 4, 3, 3 + i * 4, 3, 1.6)),
    ]),
  },
  gap: 2,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'left',
  encode: textEncoder(
    Object.fromEntries(
      Object.entries(MORSE).map(([ch, code]) => [
        ch,
        [...code].map((m, i) => `${m === '.' ? 'dot' : 'dash'}${i}`).join(' '),
      ]),
    ),
  ),
};

// Arm directions as the reader sees them.
const ARMS = {
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
} as const;
const SEMAPHORE: Record<string, string> = {
  A: 'SW S',
  B: 'W S',
  C: 'NW S',
  D: 'N S',
  E: 'S NE',
  F: 'S E',
  G: 'S SE',
  H: 'W SW',
  I: 'NW SW',
  J: 'N E',
  K: 'SW N',
  L: 'SW NE',
  M: 'SW E',
  N: 'SW SE',
  O: 'W NW',
  P: 'W N',
  Q: 'W NE',
  R: 'W E',
  S: 'W SE',
  T: 'NW N',
  U: 'NW NE',
  V: 'N SE',
  W: 'NE E',
  X: 'NE SE',
  Y: 'NW E',
  Z: 'SE E',
};

/** Flag semaphore: a hub and two of eight arms, the standard alphabet. */
export const semaphore: DisplayType = {
  name: 'semaphore',
  cell: {
    width: 16,
    height: 18,
    lights: [
      light('hub', disc(8, 9, 1.4)),
      ...Object.entries(ARMS).map(([name, [dx, dy]]) => {
        const k = Math.hypot(dx, dy);
        return light(
          name,
          bar(8 + (dx * 2.2) / k, 9 + (dy * 2.2) / k, 8 + (dx * 7) / k, 9 + (dy * 7) / k, 1.2),
        );
      }),
    ],
  },
  gap: 1,
  ends: 'round',
  socket: 'segment',
  glow: 1,
  align: 'left',
  encode: textEncoder(
    Object.fromEntries(Object.entries(SEMAPHORE).map(([ch, arms]) => [ch, `hub ${arms}`])),
  ),
};
