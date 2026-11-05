import { angle, color, kit, max, mul } from '@msb235/blits';
import { type Bitmap, ROWS } from './font.js';
import type { GridName } from './grid.js';

/**
 * What a dot shows. `lit` is how much it is on, 0 to 1, the brightest voice winning; `gain` scales
 * its brightness; `tint` is its color, which `hue` (degrees) turns and `chroma` scales; `glow`
 * scales its halo; `invert`, 0 to 1, swaps lit and dark toward the other. The scaling channels rest
 * at 1.
 */
export interface Pose {
  lit: number;
  gain: number;
  tint: number[];
  hue: number;
  chroma: number;
  glow: number;
  invert: number;
}

export const KIT = kit<Pose>({
  lit: max(),
  gain: mul(),
  tint: color(),
  hue: angle(),
  chroma: mul(),
  glow: mul(),
  invert: max(),
});

/** A dot of the sign, in dot pitches from its top left; a bulb of the border sits outside it. */
export type Led =
  | {
      readonly kind: 'dot';
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: 'bulb'; readonly i: number; readonly x: number; readonly y: number };

/** Every third bulb of the border, one subject: the mix folds three cells and each bulb shows its own. */
export interface Cell {
  readonly kind: 'cell';
  readonly i: number;
}

/** What the mix folds: a dot, or a cell of the border. */
export type Subject = Led | Cell;

/** A sign of `cols` × `rows` dots and the border round it, if it has one. */
export interface Board {
  readonly cols: number;
  readonly rows: number;
  /** The space round the dots, in pitches: room for the border's bulbs, or a dot's width without one. */
  readonly margin: number;
  readonly dots: readonly Led[];
  readonly bulbs: readonly Led[];
  readonly cells: readonly Cell[];
  /** Per bulb, the index of its cell in `cells`. */
  readonly cellOf: Uint8Array;
  /** Where the dots stand, where a grid is named: `triangles` lays text out two places to a dot. */
  readonly grid?: GridName;
}

/** The 80 × 7 of a shopfront sign. */
export const SIZE = { cols: 80, rows: ROWS } as const;

/** The space round a sign's dots, in pitches, with a border of bulbs or without one. */
export const marginOf = (border: boolean) => (border ? 3 : 1);

/**
 * A sign of any size, with a border of bulbs unless `border` is false; where its text stands is up
 * to each placement (`place`).
 */
export function board(cols: number, rows: number, border = true, grid?: GridName): Board {
  const dots: Led[] = Array.from({ length: cols * rows }, (_, k) => ({
    kind: 'dot',
    x: k % cols,
    y: Math.floor(k / cols),
  }));
  const at = border ? ring(cols + 2, rows + 2) : [];
  const bulbs: Led[] = at.map(([x, y], i) => ({ kind: 'bulb', i, x, y }));
  const cells: Cell[] = [0, 1, 2].map((i) => ({ kind: 'cell', i }));
  const cellOf = Uint8Array.from(bulbs, (_, i) => i % 3);
  return {
    cols,
    rows,
    margin: marginOf(border),
    dots,
    bulbs,
    cells,
    cellOf,
    ...(grid && { grid }),
  };
}

/**
 * Bulb places round a border `w` × `h` from its top left corner, clockwise: one on every corner,
 * each side evenly spaced near 2 apart, and a count divisible by 3 so a three-cell chase closes.
 */
function ring(w: number, h: number): [number, number][] {
  const near = (len: number) => Math.max(1, Math.round(len / 2));
  let best: [number, number] = [near(w), near(h)];
  let cost = Number.POSITIVE_INFINITY;
  for (let da = -1; da <= 1; da++)
    for (let db = -1; db <= 1; db++) {
      const a = near(w) + da;
      const b = near(h) + db;
      if (a < 1 || b < 1 || (a + b) % 3 !== 0) continue;
      const off = a * Math.abs(w / a - 2) + b * Math.abs(h / b - 2);
      if (off < cost) [best, cost] = [[a, b], off];
    }
  const [a, b] = best;
  const x0 = -1.5;
  const y0 = -1.5;
  const at: [number, number][] = [];
  for (let k = 0; k < a; k++) at.push([x0 + (w * k) / a, y0]);
  for (let k = 0; k < b; k++) at.push([x0 + w, y0 + (h * k) / b]);
  for (let k = 0; k < a; k++) at.push([x0 + w - (w * k) / a, y0 + h]);
  for (let k = 0; k < b; k++) at.push([x0, y0 + h - (h * k) / b]);
  return at;
}

/** The column a message standing centered starts at. */
export const leftOf = (b: Board, text: Bitmap) => Math.floor((b.cols - text.cols) / 2);

const every = new WeakMap<Board, readonly Subject[]>();

/** A board's dots and cells, the one list a shader patch plays on, as the gpu engine needs. */
export function everyOf(b: Board): readonly Subject[] {
  let all = every.get(b);
  if (!all) {
    all = [...b.dots, ...b.cells];
    every.set(b, all);
  }
  return all;
}
