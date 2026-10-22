import { color, kit, max, oklab, patch } from '@msb235/blits';
import { type Bitmap, ROWS } from './font';

/** How bright a dot is, 0 to 1, and its color; the brightest voice on a dot wins. */
export interface Pose {
  lit: number;
  tint: number[];
}

export const KIT = kit<Pose>({ lit: max(), tint: color() });

/** A dot of the sign, in dot pitches from its top left; a bulb of the border sits outside it. */
export type Led =
  | {
      readonly kind: 'dot';
      readonly x: number;
      readonly y: number;
      /** The row of the text this dot shows, or -1 between lines. */
      readonly row: number;
    }
  | { readonly kind: 'bulb'; readonly i: number; readonly x: number; readonly y: number };

/** A sign of `cols` × `rows` dots and the border round it. */
export interface Board {
  readonly cols: number;
  readonly rows: number;
  readonly dots: readonly Led[];
  readonly bulbs: readonly Led[];
}

/** The 80 × 7 of a shopfront sign. */
export const SIZE = { cols: 80, rows: ROWS } as const;

/**
 * A sign of any size. Past one line of text it stacks lines a dot apart, centered, every line
 * showing the same message; below one line it shows the top of the text.
 */
export function board(cols: number, rows: number): Board {
  const pitch = ROWS + 1;
  const lines = Math.max(1, Math.floor((rows + 1) / pitch));
  const top = Math.max(0, Math.floor((rows - (lines * pitch - 1)) / 2));
  const rowOf = (y: number) => {
    const k = y - top;
    if (k < 0 || k >= lines * pitch) return -1;
    return k % pitch < ROWS ? k % pitch : -1;
  };
  const dots: Led[] = Array.from({ length: cols * rows }, (_, k) => {
    const y = Math.floor(k / cols);
    return { kind: 'dot', x: k % cols, y, row: rowOf(y) };
  });
  const left = -1.5;
  const right = cols + 0.5;
  const above = -1.5;
  const below = rows + 0.5;
  const at: [number, number][] = [];
  for (let x = left; x < right; x += 2) at.push([x, above]);
  for (let y = above; y < below; y += 2) at.push([right, y]);
  for (let x = right; x > left; x -= 2) at.push([x, below]);
  for (let y = below; y > above; y -= 2) at.push([left, y]);
  const bulbs: Led[] = at.map(([x, y], i) => ({ kind: 'bulb', i, x, y }));
  return { cols, rows, dots, bulbs };
}

/** How long the sign takes to move one column, at rate 1. */
export const STEP_MS = 45;

/** Text entering at the right edge and leaving at the left, a whole column at a time. */
export function scroll(b: Board, text: Bitmap, hex: number) {
  const tint = oklab(hex);
  const steps = text.cols + b.cols;
  return patch<Led, Pose>(
    steps * STEP_MS,
    (phase, led) => {
      const offset = Math.floor(phase * steps) - b.cols;
      const row = led.kind === 'dot' ? led.row : -1;
      return { lit: text.lit(led.x + offset, row) ? 1 : 0, tint };
    },
    { writes: ['lit', 'tint'] },
  );
}

export const HOLD_MS = 3600;
/** How much later each column starts than the one to its left, so a held message wipes on and off. */
export const WIPE_MS = 14;

/**
 * Text standing centered, flashing in the middle of its time. Cued with a stagger by column, which
 * gives the wipe on and off: each column plays the same pass, later.
 */
export function hold(b: Board, text: Bitmap, hex: number) {
  const tint = oklab(hex);
  const left = Math.floor((b.cols - text.cols) / 2);
  return patch<Led, Pose>(
    HOLD_MS,
    (phase, led) => {
      const t = phase * HOLD_MS;
      const flashing = t > 1200 && t < 2400 && Math.floor((t - 1200) / 200) % 2 === 1;
      const row = led.kind === 'dot' ? led.row : -1;
      const on = !flashing && phase < 0.97 && text.lit(led.x - left, row);
      return { lit: on ? 1 : 0, tint };
    },
    { writes: ['lit', 'tint'] },
  );
}

/** A dot's sparkle at one twentieth of a second: a hash of where and when, 0 to 1. */
export function twinkle(x: number, y: number, frame: number): number {
  let h =
    Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(frame, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0x1_0000_0000;
}

/** Stray dots lighting for a moment, about one in a hundred and fifty at any time. Loops. */
export const sparkle = patch<Led, Pose>(
  1000,
  (phase, led) => {
    const h = twinkle(led.x, led.y, Math.floor(phase * 20));
    return { lit: h > 0.9933 ? (h - 0.9933) / 0.0067 : 0 };
  },
  { writes: ['lit'] },
);

export const CHASE_MS = 180;
const BULB = oklab(0xffe2b0);

/** The theater chase: every third bulb lit, the pattern stepping one bulb on each beat. Loops. */
export const chase = patch<Led, Pose>(
  CHASE_MS * 3,
  (phase, led) => {
    const beat = Math.floor(phase * 3);
    const i = led.kind === 'bulb' ? led.i : 0;
    return { lit: (i + 3 - beat) % 3 === 0 ? 1 : 0.1, tint: BULB };
  },
  { writes: ['lit', 'tint'] },
);
