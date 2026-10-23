import { color, kit, max } from '@msb235/blits';
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

/** Every third bulb of the border, one subject: the mix folds three cells and each bulb shows its own. */
export interface Cell {
  readonly kind: 'cell';
  readonly i: number;
}

/** What the mix folds: a dot, or a cell of the border. */
export type Subject = Led | Cell;

/** A sign of `cols` × `rows` dots and the border round it. */
export interface Board {
  readonly cols: number;
  readonly rows: number;
  /** How many lines of text fit, each showing the same message. */
  readonly lines: number;
  readonly dots: readonly Led[];
  readonly bulbs: readonly Led[];
  readonly cells: readonly Cell[];
  /** Per bulb, the index of its cell in `cells`. */
  readonly cellOf: Uint8Array;
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
  const cells: Cell[] = [0, 1, 2].map((i) => ({ kind: 'cell', i }));
  const cellOf = Uint8Array.from(bulbs, (_, i) => i % 3);
  return { cols, rows, lines, dots, bulbs, cells, cellOf };
}

/** The column a message standing centered starts at. */
export const leftOf = (b: Board, text: Bitmap) => Math.floor((b.cols - text.cols) / 2);
