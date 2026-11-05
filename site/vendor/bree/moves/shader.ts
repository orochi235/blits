import type { ShaderPatch } from '@msb235/blits/gpu';
import type { Pose, Subject } from '../board.js';
import { type Bound, type Given, kernels, type Tables } from '../modulators/shader.js';
import type { Placed } from '../orders.js';

/** A move's pass as a shader patch, writing `lit` on every dot and 0 on every cell. */
export type MoveShader = ShaderPatch<Subject, Pose, Bound>;

/** A table read in JS: `(x, y)` floored, 0 outside. */
export type Lookup = (x: number, y: number) => number;

/** A table's size and its contents row by row. */
export interface Table {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

/**
 * The message's levels, and the text row each dot row shows plus 1 (0 for none), as tables. `rows`
 * starts `lead` rows above the board, since a row moved down from above it can still show the
 * text's ghost rows, and runs to as far below the board as any text row reaches.
 */
export interface BitmapTables {
  readonly bitmap: Float32Array;
  readonly rows: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly rowsLen: number;
  readonly lead: number;
}

const placedTables = new WeakMap<Placed, BitmapTables>();

/** `at`'s text and row map as the tables every move shader reads; a table is at least 1 × 1. */
export function bitmapTables(at: Placed): BitmapTables {
  const had = placedTables.get(at);
  if (had) return had;
  const width = Math.max(1, at.text.cols);
  const height = Math.max(1, at.text.rows);
  const bitmap = new Float32Array(width * height);
  for (let y = 0; y < at.text.rows; y++)
    for (let x = 0; x < at.text.cols; x++) bitmap[y * width + x] = at.text.level(x, y);
  const lead = at.text.rows;
  const rowsLen = at.board.rows + 2 * lead;
  const rows = Float32Array.from(
    { length: rowsLen },
    (_, k) => at.rowOf({ kind: 'dot', x: 0, y: k - lead }) + 1,
  );
  const made = { bitmap, rows, width, height, rowsLen, lead };
  placedTables.set(at, made);
  return made;
}

/** WGSL for the rows table at dot row `y`: the text row it shows plus 1, or 0. */
const ROWS = (y: string) => `table_rows(0.0, (${y}) + params.lead)`;

/**
 * WGSL for `litAt`: how brightly the message, its left edge at column `x0` and moved `dy` rows
 * down, lights the dot, reading `row`, the text row the dot shows.
 */
export const LIT = (x0: string, dy = '0.0') =>
  `select(0.0, table_bitmap(subject.x - (${x0}), row - (${dy})), row >= 0.0)`;

/**
 * WGSL for `movedAt`: how brightly the message, its left edge at column `x0`, lights the dot,
 * reading the row the dot would show `dy` rows up.
 */
export const MOVED = (x0: string, dy: string) =>
  `select(0.0, table_bitmap(subject.x - (${x0}), ${ROWS(`subject.y - (${dy})`)} - 1.0), ${ROWS(`subject.y - (${dy})`)} >= 1.0)`;

/** `MOVED` in JS, reading the same tables. */
export function movedOf(t: Tables, d: { x: number; y: number }, x0: number, dy: number): number {
  const row = (t.rows as Lookup)(0, d.y - dy) - 1;
  return row >= 0 ? (t.bitmap as Lookup)(d.x - x0, row) : 0;
}

/** `LIT` in JS, reading the same tables. */
export function litOf(t: Tables, d: { x: number; y: number }, x0: number, dy = 0): number {
  const row = (t.rows as Lookup)(0, d.y) - 1;
  return row >= 0 ? (t.bitmap as Lookup)(d.x - x0, row - dy) : 0;
}

/** WGSL for `Math.round`, which rounds halves up where WGSL's `round` rounds them to even. */
export const ROUND = (x: string) => `floor((${x}) + 0.5)`;

/** What `moveShader` takes: a move's pass for one dot, written twice. */
export interface MoveSpec {
  /**
   * WGSL statements setting `lit` for a dot, from `phase`, `subject`, `params.<name>`, `row` (the
   * text row the dot shows, or -1) and the tables.
   */
  readonly wgsl: string;
  /** The names of the numbers it reads, as `params.<name>` in WGSL. */
  readonly params: readonly string[];
  /** The same in JS: the dot's `lit`; its `rows` table is read by dot row, as `ROWS` reads it. */
  at(phase: number, dot: { x: number; y: number }, p: Bound, t: Tables): number;
}

/**
 * A move's shader on a placed message: cues of one duration and table sizes share a kernel, and
 * each is bound with its numbers and tables. Null on a blits whose shader patches have no tables.
 */
export function moveShader(
  spec: MoveSpec,
): (
  at: Placed,
  duration: number,
  values: Bound,
  extra?: Record<string, Table>,
) => MoveShader | null {
  const bind = kernels({
    params: ['lead', ...spec.params],
    wgsl: `var lit = 0.0;
if (subject.cell < 0.5) {
  let row = ${ROWS('subject.y')} - 1.0;
  ${spec.wgsl}
}
out.lit = lit;`,
    at(phase, s, v) {
      if (s.kind === 'cell') return { lit: 0 };
      const t = v as unknown as Tables;
      const lead = v.lead as number;
      const rows = (x: number, y: number) => (t.rows as Lookup)(x, y + lead);
      return { lit: spec.at(phase, s, v, { ...t, rows }) };
    },
    writes: ['lit'],
  });
  return (at, duration, values, extra = {}) => {
    const bt = bitmapTables(at);
    const tables: Record<string, Table> = {
      bitmap: { width: bt.width, height: bt.height, data: bt.bitmap },
      rows: { width: 1, height: bt.rowsLen, data: bt.rows },
      ...extra,
    };
    const given: Given = { ...values, lead: bt.lead };
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const [n, t] of Object.entries(tables)) {
      given[n] = t.data;
      sizes[n] = { width: t.width, height: t.height };
    }
    return bind(duration, sizes, given);
  };
}
