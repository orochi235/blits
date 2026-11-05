import type { Face } from '../faces.js';

/** A face drawn from a table of glyphs, as tall and wide as its largest. */
export const tableFace = (
  name: string,
  about: string,
  table: Readonly<Record<string, readonly string[]>>,
): Face => {
  const all = Object.values(table);
  return {
    name,
    about,
    rows: Math.max(0, ...all.map((g) => g.length)),
    width: Math.max(0, ...all.flatMap((g) => g.map((row) => row.length))),
    glyph: (ch) => (Object.hasOwn(table, ch) ? table[ch] : undefined),
  };
};

/**
 * A face packed one glyph to a string of hex digits: its width, its height, and its bottom row's
 * place below the baseline plus 8, then each column top first in ceil(height / 4) digits, bit 0
 * the top row. `body` is the capitals' height; whatever a glyph draws above or below it becomes the
 * face's ghost rows, so no dot is dropped.
 */
export const packedFace = (
  name: string,
  about: string,
  body: number,
  packed: Readonly<Record<string, string>>,
): Face => {
  const glyphs = Object.entries(packed).map(([ch, g]) => {
    const [w, h, b] = [0, 1, 2].map((i) => Number.parseInt(g[i] as string, 16)) as [
      number,
      number,
      number,
    ];
    const digits = Math.ceil(h / 4);
    const cols = Array.from({ length: w }, (_, x) =>
      Number.parseInt(g.slice(3 + x * digits, 3 + (x + 1) * digits), 16),
    );
    return { ch, w, h, bottom: b - 8, cols };
  });
  const above = Math.max(0, ...glyphs.map((g) => g.bottom + g.h - body));
  const below = Math.max(0, ...glyphs.map((g) => -g.bottom));
  const width = Math.max(1, ...glyphs.map((g) => g.w));
  const rows = above + body + below;
  const table: Record<string, readonly string[]> = { ' ': Array(rows).fill('.'.repeat(width)) };
  for (const { ch, w, h, bottom, cols } of glyphs) {
    const left = Math.floor((width - w) / 2);
    // Row r of the face is `above + body - 1 - r` dots above the baseline.
    table[ch] = Array.from({ length: rows }, (_, r) => {
      const k = bottom + h - 1 - (above + body - 1 - r);
      return Array.from({ length: width }, (_, x) => {
        const c = cols[x - left];
        return c !== undefined && k >= 0 && k < h && (c >> k) & 1 ? '#' : '.';
      }).join('');
    });
  }
  return { ...tableFace(name, about, table), above, below };
};
