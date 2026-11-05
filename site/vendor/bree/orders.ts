import { type Board, board as boardOf, type Led, leftOf, type Subject } from './board.js';
import { faceOf, widened } from './faces.js';
import { type Bitmap, type Look, rasterize } from './font.js';
import { hash } from './hash.js';
import { duration } from './params.js';

export type OrderBy =
  | 'together'
  | 'column'
  | 'column-reverse'
  | 'center'
  | 'row'
  | 'letter'
  | 'random';

// A record, so a new OrderBy fails to compile until it is listed here.
const BY: Record<OrderBy, true> = {
  together: true,
  column: true,
  'column-reverse': true,
  center: true,
  row: true,
  letter: true,
  random: true,
};
/** Every order, by name. */
export const ORDERS = Object.keys(BY) as readonly OrderBy[];

/** When, or at what phase, each dot of the sign does something: a rank per subject, spread by `lag`. */
export interface Order {
  readonly by: OrderBy;
  /** Delay per rank. Default 0. */
  readonly lag?: number;
  /** Which shuffle `random` makes. Default 1. */
  readonly seed?: number;
}

/** A message placed on a board. */
export interface Placed {
  readonly board: Board;
  readonly text: Bitmap;
  readonly left: number;
  /** How many lines of the message the board stacks, each showing the same text. */
  readonly lines: number;
  /** The row of the text a dot shows, or -1 for one no line reaches, or a bulb. */
  rowOf(led: Led): number;
  /** Rows of the text with a lit dot that no dot of the board shows. */
  readonly cut: readonly number[];
  /** The message as typed, for warnings. */
  readonly label?: string;
}

/**
 * The message standing centered on the board, its lines a dot apart by its letters' body height
 * and as many as fit, each showing the same text. Ghost rows reach into the gap between lines or
 * the board's margin; what runs past the board's edge is cut, and named in `cut`. A board shorter
 * than one line shows the top of it.
 */
export function place(board: Board, text: Bitmap): Placed {
  const body = text.rows - text.above - text.below;
  const pitch = body + 1;
  const lines = Math.max(1, Math.floor((board.rows + 1) / pitch));
  const top = Math.max(0, Math.floor((board.rows - (lines * pitch - 1)) / 2));
  const rowAt = (y: number) => {
    const n = Math.min(lines - 1, Math.max(0, Math.floor((y - top) / pitch)));
    for (const k of [n, n + 1, n - 1]) {
      if (k < 0 || k >= lines) continue;
      const r = y - (top + k * pitch) + text.above;
      if (r >= 0 && r < text.rows) return r;
    }
    return -1;
  };
  const shown = new Set(Array.from({ length: board.rows }, (_, y) => rowAt(y)));
  const cut = Array.from({ length: text.rows }, (_, r) => r).filter(
    (r) =>
      !shown.has(r) && Array.from({ length: text.cols }, (_, x) => x).some((x) => text.lit(x, r)),
  );
  return {
    board,
    text,
    left: leftOf(board, text),
    lines,
    rowOf: (led) => (led.kind === 'dot' ? rowAt(led.y) : -1),
    cut,
  };
}

/** The fewest rows a board as wide as `board` needs to show every dot of `text`. */
export function rowsToShow(board: Board, text: Bitmap): number {
  let rows = board.rows;
  const most = board.rows + 2 * text.rows + 2;
  while (rows < most && place(boardOf(board.cols, rows), text).cut.length > 0) rows++;
  return rows;
}

/** A message as typed, rasterized in `look` and standing centered on the board, labeled for warnings. */
export const placeText = (board: Board, text: string, look?: Look): Placed => ({
  ...place(board, rasterize(text, lookOn(board, look))),
  label: text,
});

/**
 * `look` as `board` shows it: on the triangle tiling a face's columns are doubled, two places to a
 * dot, its letters spaced a dot apart; the `strokes` face is drawn there as it is.
 */
export function lookOn(board: Board, look: Look = {}): Look {
  const face = faceOf(look.face);
  if (board.grid !== 'triangles' || face.name === 'strokes') return look;
  const tracking = look.style?.tracking ?? 0;
  return {
    face: widened(face),
    style: { ...look.style, tracking: Math.min(6, tracking * 2 + 1) },
  };
}

const shuffle = (cols: number, seed: number): readonly number[] => {
  const order = Array.from({ length: cols }, (_, x) => x).sort(
    (a, b) => hash(a, seed, cols) - hash(b, seed, cols) || a - b,
  );
  const ranks = new Array<number>(cols);
  order.forEach((x, rank) => {
    ranks[x] = rank;
  });
  return ranks;
};

/** The column of a board `cols` wide a dot or bulb stands in, the nearest edge for a bulb past it. */
const colOf = (cols: number, s: Led) => Math.min(cols - 1, Math.max(0, Math.round(s.x)));

/** The orders whose rank is a closed form of a subject's place and the board's width, by code. */
export const CLOSED: Partial<Record<OrderBy, number>> = {
  together: 0,
  column: 1,
  'column-reverse': 2,
  center: 3,
  row: 4,
};

/** A subject's rank under the order whose `CLOSED` code is `by`, on a board `cols` wide. */
export function closedRank(by: number, cols: number, s: Subject): number {
  if (by === 0) return 0;
  if (s.kind === 'cell') return s.i;
  if (by === 1) return colOf(cols, s);
  if (by === 2) return cols - 1 - colOf(cols, s);
  if (by === 3) return Math.floor(Math.abs(colOf(cols, s) - (cols - 1) / 2));
  return s.y;
}

/** The rank of a subject: an integer from 0, equal ranks acting together. */
export function rankOf(order: Order, at: Placed): (s: Subject) => number {
  const { cols } = at.board;
  const closed = CLOSED[order.by];
  if (closed !== undefined) return (s) => closedRank(closed, cols, s);
  const pick = (dot: (s: Led) => number) => (s: Subject) => (s.kind === 'cell' ? s.i : dot(s));
  if (order.by === 'letter') {
    const { text } = at;
    const last = Math.max(0, text.letters.length - 1);
    return pick((s) => {
      const x = Math.floor(s.x - at.left);
      const y = s.kind === 'dot' ? at.rowOf(s) : undefined;
      return x < 0 ? 0 : x >= text.cols ? last : Math.max(0, text.letterAt(x, y));
    });
  }
  const ranks = shuffle(cols, order.seed ?? 1);
  return pick((s) => ranks[colOf(cols, s)] as number);
}

/** The delay of a subject: its rank times the lag. */
export function delayOf(order: Order, at: Placed): (s: Subject) => number {
  const rank = rankOf(order, at);
  const lag = duration(order.lag) ?? 0;
  return (s) => rank(s) * lag;
}

/** The largest delay over the board's dots. */
export function spanOf(order: Order, at: Placed): number {
  const delay = delayOf(order, at);
  return at.board.dots.reduce((m, d) => Math.max(m, delay(d)), 0);
}

/** The board's dots grouped by rank, lowest rank first, empty groups dropped. */
export function groupsOf(order: Order, at: Placed): readonly (readonly Led[])[] {
  const rank = rankOf(order, at);
  const groups = new Map<number, Led[]>();
  for (const dot of at.board.dots) {
    const r = rank(dot);
    const g = groups.get(r);
    if (g) g.push(dot);
    else groups.set(r, [dot]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}
