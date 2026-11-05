import type { Face } from '../faces.js';
import { TRI_H, triangleAt } from '../grid.js';
import { sixteen } from '../readout/types/alpha.js';

/** How many triangle rows and columns a stroke glyph takes. */
const ROWS = 14;
const COLS = 14;
/** How far past a stroke's own half width a triangle's middle may sit and still light. */
const REACH = 0.35;

const { cell } = sixteen;
/** Glyph units per pitch, the glyph's height filling the rows. */
const UNIT = cell.height / (ROWS * TRI_H);
/** The glyph centered across the columns' span. */
const LEFT = (((COLS + 1) / 2) * UNIT - cell.width) / 2;

const near = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - x1 - dx * t, py - y1 - dy * t);
};

/** `ch`'s 16-segment glyph, a triangle lit where its middle falls on a lit stroke. */
function sampled(ch: string): readonly string[] | undefined {
  const on = sixteen.encode(ch, 1, 'left')[0];
  if (!on || (on.size === 0 && ch !== ' ')) return undefined;
  const shapes = cell.lights.filter((l) => on.has(l.name)).flatMap((l) => l.shapes);
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, k) => {
      const [mx, my] = triangleAt(k, r).middle;
      const x = mx * UNIT - LEFT;
      const y = my * UNIT;
      const hit = shapes.some((b) =>
        b.kind === 'bar'
          ? near(x, y, b.x1, b.y1, b.x2, b.y2) <= b.w / 2 + REACH
          : b.kind === 'disc' && Math.hypot(x - b.x, y - b.y) <= b.r + REACH,
      );
      return hit ? '#' : '.';
    }).join(''),
  );
}

const cache = new Map<string, readonly string[] | undefined>();

/**
 * Letters drawn at triangle resolution: the 16-segment glyphs' strokes laid over 14 rows of the
 * triangle tiling, each triangle lit where its middle falls on one. Made for a sign on
 * `grid: 'triangles'`, which shows each place as its own triangle rather than two to a dot.
 */
export const STROKES: Face = {
  name: 'strokes',
  about:
    'Letters drawn at triangle resolution from 16-segment strokes, for a triangle sign 14 or more rows tall.',
  rows: ROWS,
  width: COLS,
  glyph(ch) {
    if (!cache.has(ch)) cache.set(ch, sampled(ch));
    return cache.get(ch);
  },
};
