import { type Face, type FaceName, faceOf } from './faces.js';
import { cut, dress, layout } from './glyph.js';

export { SHADOW } from './glyph.js';

import { type Params, values } from './params.js';

/** The sign's default height, and the body height of the drawn faces. */
export const ROWS = 7;

/**
 * How text is drawn besides its face. `outline` draws each letter hollow: the ring of dots
 * around it lit and the letter dark. `shadow` lays a dim copy of each letter one dot down and right, behind it. Each glyph, outline
 * and shadow included, is kerned by its shape: it slides left until its ink is a blank from the
 * ink before it in the same row and the rows either side, so no two letters touch, even at a
 * corner. `monospace` advances every glyph by its widest instead.
 */
export interface TextStyle {
  readonly monospace?: boolean;
  readonly outline?: boolean;
  readonly shadow?: boolean;
  /** Blanks between letters past the one they keep: more spreads them, -1 lets them touch. */
  readonly tracking?: number;
}

/** A style's number settings, with their ranges. */
export const LOOK = {
  params: {
    tracking: {
      label: 'tracking',
      min: -1,
      max: 6,
      step: 1,
      value: 0,
      unit: 'dots',
      about:
        'How many more blank columns sit between letters than the one they keep. More spreads the message out; −1 lets the letters touch.',
    },
  },
} as const satisfies { readonly params: Params };

/** A face and a style; a program scene is one. Default: the standard face, plain. */
export interface Look {
  readonly face?: FaceName | Face;
  readonly style?: TextStyle;
}

/** A letter's run of columns, and the first row of its line. */
export interface Span {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** Text laid out as lit dots, `cols` × `rows`; a glyph the face lacks is a blank. */
export interface Bitmap {
  readonly cols: number;
  /**
   * Ghost rows at the top and bottom of `rows`: drawn, but not counted when lines are spaced. An
   * outline adds one at each, and a shadow one at the bottom.
   */
  readonly above: number;
  readonly below: number;
  readonly rows: number;
  /**
   * Each letter's columns, in order: its glyph and a blank beside it, and the first row of its
   * line. One letter of the same look rasterized alone draws the same dots at the same place in its
   * own span, `y` rows down. Kerned letters' spans can overlap.
   */
  readonly letters: readonly Span[];
  readonly face: Face;
  readonly style: TextStyle;
  /** How brightly the dot at column `x`, row `y` lights, 0 to 1; anything outside the text is 0. */
  level(x: number, y: number): number;
  /** Whether the dot at column `x`, row `y` lights at all. */
  lit(x: number, y: number): boolean;
  /**
   * The index of the letter whose span holds column `x`, or -1 outside them all. Given row `y`, the
   * letter on that row's line, and a lit dot its own letter's where kerned spans overlap; elsewhere
   * the later span has it.
   */
  letterAt(x: number, y?: number): number;
}

/**
 * `text` laid out as dots in `look`, a line for each `\n`-separated part. Lines stack a blank row
 * apart by their letters' body, as a sign stacks repeated lines, each centered on the widest.
 */
export function rasterize(text: string, look: Look = {}): Bitmap {
  const face = faceOf(look.face);
  const style = look.style ?? {};
  const monospace = style.monospace ?? false;
  const gap = 1 + Math.round(values(LOOK, style).tracking);
  const top = style.outline ? 1 : 0;
  const lineRows = face.rows + top + (style.outline ? 1 : 0) + (style.shadow ? 1 : 0);
  const above = (face.above ?? 0) + top;
  const below = (face.below ?? 0) + lineRows - face.rows - top;
  const pitch = lineRows - above - below + 1;
  const lines = text
    .toUpperCase()
    .split('\n')
    .map((line) => {
      const glyphs = [...line].map((ch) => dress(cut(face, ch, monospace), style));
      const xs = layout(glyphs, lineRows, monospace, gap);
      const cols = glyphs.reduce((n, g, k) => Math.max(n, (xs[k] as number) + g.width + 1), 0);
      return { glyphs, xs, cols };
    });
  const cols = Math.max(...lines.map((l) => l.cols));
  const rows = lineRows + (lines.length - 1) * pitch;
  const levels = new Float32Array(cols * rows);
  const owner = new Int32Array(cols * rows).fill(-1);
  const inkOwner = new Int32Array(cols * rows).fill(-1);
  const letters: Span[] = [];
  lines.forEach((line, n) => {
    const dy = n * pitch;
    const dx = Math.floor((cols - line.cols) / 2);
    line.glyphs.forEach((g, j) => {
      const k = letters.length;
      const at = dx + (line.xs[j] as number);
      g.cells.forEach((r, y) => {
        r.forEach((v, x) => {
          const i = (dy + y) * cols + at + x;
          // A letter stands in front of the shadow of the one before it.
          if (v > (levels[i] as number)) {
            levels[i] = v;
            inkOwner[i] = k;
          }
        });
      });
      const width = g.width + 1;
      letters.push({ x: at, y: dy, width });
      for (let y = dy; y < dy + lineRows; y++) owner.fill(k, y * cols + at, y * cols + at + width);
    });
  });
  const inside = (x: number, y: number) => x >= 0 && x < cols && y >= 0 && y < rows;
  const level = (x: number, y: number) => (inside(x, y) ? (levels[y * cols + x] as number) : 0);
  return {
    cols,
    rows,
    above,
    below,
    letters,
    face,
    style,
    level,
    lit: (x, y) => level(x, y) > 0,
    letterAt: (x, y) => {
      if (x < 0 || x >= cols) return -1;
      if (y === undefined || !inside(x, y))
        return Math.max(
          -1,
          ...letters.flatMap((l, k) => (x >= l.x && x < l.x + l.width ? [k] : [])),
        );
      const ink = inkOwner[y * cols + x] as number;
      return ink >= 0 ? ink : (owner[y * cols + x] as number);
    },
  };
}

export { CHARS, FACE_NAMES, FACES, type Face, type FaceName, faceOf } from './faces.js';
