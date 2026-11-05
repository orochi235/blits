import type { Face } from './faces.js';
import type { TextStyle } from './font.js';

/** How brightly a shadow lights, against the letters' 1. */
export const SHADOW = 0.35;

/** A glyph as the levels of its dots, a row each, every row `width` long. */
export interface Glyph {
  readonly width: number;
  readonly cells: readonly (readonly number[])[];
}

const inked = (g: Glyph) => g.cells.some((r) => r.some((v) => v > 0));

/** A glyph's drawn columns: all of its face's width at fixed pitch, else those holding ink. */
export function cut(face: Face, ch: string, monospace: boolean): Glyph {
  const rows = face.glyph(ch) ?? face.glyph(' ') ?? [];
  const ink = Array.from({ length: face.width }, (_, x) => rows.some((r) => r[x] === '#'));
  const blank = !ink.includes(true);
  const from = monospace || blank ? 0 : ink.indexOf(true);
  const width = monospace
    ? face.width
    : blank
      ? Math.ceil(face.width / 2)
      : ink.lastIndexOf(true) - from + 1;
  const cells = Array.from({ length: face.rows }, (_, y) =>
    Array.from({ length: width }, (_, x) => (rows[y]?.[from + x] === '#' ? 1 : 0)),
  );
  return { width, cells };
}

/** `g` grown by `left`, `right`, `top` and `bottom` blank dots, each cell from `at` of the old. */
function grow(
  g: Glyph,
  [top, right, bottom, left]: readonly number[],
  at: (v: (y: number, x: number) => number, y: number, x: number) => number,
): Glyph {
  const v = (y: number, x: number) => g.cells[y]?.[x] ?? 0;
  const width = g.width + (left as number) + (right as number);
  const rows = g.cells.length + (top as number) + (bottom as number);
  const cells = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: width }, (_, x) => at(v, y - (top as number), x - (left as number))),
  );
  return { width, cells };
}

/**
 * A glyph as `style` dresses it: outlined, then shadowed. A blank keeps its width, only taking the
 * rows the others gain.
 */
export function dress(g: Glyph, style: TextStyle): Glyph {
  const blank = !inked(g);
  let out = g;
  if (style.outline)
    out = grow(out, blank ? [1, 0, 1, 0] : [1, 1, 1, 1], (v, y, x) => {
      if (v(y, x) > 0) return 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (v(y + dy, x + dx) > 0) return 1;
      return 0;
    });
  if (style.shadow)
    out = grow(out, blank ? [0, 0, 1, 0] : [0, 1, 1, 0], (v, y, x) =>
      v(y, x) > 0 ? v(y, x) : v(y - 1, x - 1) > 0 ? SHADOW : 0,
    );
  return out;
}

/**
 * Each glyph's first column: fixed pitch, or kerned against the ink of every glyph before it,
 * `gap` blanks apart.
 */
export function layout(
  glyphs: readonly Glyph[],
  rows: number,
  monospace: boolean,
  gap: number,
): number[] {
  const xs: number[] = [];
  // The rightmost ink placed so far in each row; a space counts as ink in every row.
  const reach = new Array<number>(rows).fill(Number.NEGATIVE_INFINITY);
  let start = 0;
  let next = 0;
  for (const g of glyphs) {
    const ink = g.cells.map((r) => r.findIndex((v) => v > 0));
    const blank = ink.every((i) => i < 0);
    let x = next;
    if (!monospace && !blank) {
      // The gap from the ink before in the rows above and below too, so letters never touch corners.
      const near = (y: number) =>
        Math.max(...[y - 1, y, y + 1].map((r) => reach[r] ?? Number.NEGATIVE_INFINITY));
      const fits = ink.map((i, y) => (i < 0 ? Number.NEGATIVE_INFINITY : near(y) + 1 + gap - i));
      x = Math.max(start, Math.min(next, Math.max(...fits)));
    }
    xs.push(x);
    g.cells.forEach((r, y) => {
      let right = blank ? g.width - 1 : -1;
      for (let u = g.width - 1; u >= 0 && right < 0; u--) if ((r[u] as number) > 0) right = u;
      if (right >= 0) reach[y] = Math.max(reach[y] as number, x + right);
    });
    start = x;
    next = Math.max(next, x + g.width + gap);
  }
  return xs;
}
