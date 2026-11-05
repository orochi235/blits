import type { SegLight, SegShape } from '../type.js';

/** A bar segment's full width, in cell units. */
export const BAR_W = 1.4;

/** A bar from (x1, y1) to (x2, y2). */
export const bar = (x1: number, y1: number, x2: number, y2: number, w = BAR_W): SegShape => ({
  kind: 'bar',
  x1,
  y1,
  x2,
  y2,
  w,
});

/** A disc at (x, y). */
export const disc = (x: number, y: number, r: number): SegShape => ({ kind: 'disc', x, y, r });

/** A light made of one or more shapes. */
export const light = (name: string, ...shapes: SegShape[]): SegLight => ({ name, shapes });

/** The outer ring of a 10 × 18 cell: `a` on top, clockwise to `f`. */
export const RING: readonly SegLight[] = [
  light('a', bar(2, 1, 8, 1)),
  light('b', bar(9, 2, 9, 8)),
  light('c', bar(9, 10, 9, 16)),
  light('d', bar(2, 17, 8, 17)),
  light('e', bar(1, 10, 1, 16)),
  light('f', bar(1, 2, 1, 8)),
];

/** The decimal point, past the cell's bottom right. */
export const DP = light('dp', disc(10.6, 17, 0.7));
