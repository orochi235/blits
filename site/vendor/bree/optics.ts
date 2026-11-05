import type { Board } from './board.js';

/** How long a light takes to light and to go dark, ms: a filament warms fast and cools slowly. */
export interface Fade {
  readonly rise?: number;
  readonly fall?: number;
}

/**
 * How much of its lit neighbors an unlit dot shows, 0 to 1: `row` from the dots sharing its row,
 * `col` from those sharing its column, each the share of their mean brightness that leaks across.
 */
export interface Ghost {
  readonly row?: number;
  readonly col?: number;
}

export const FADE = { rise: 12, fall: 110 } as const;

/** Where a light that showed `was` stands `dt` ms later, heading for `target`. */
export function settle(was: number, target: number, dt: number, fade: Fade = FADE): number {
  const ms = target > was ? (fade.rise ?? FADE.rise) : (fade.fall ?? FADE.fall);
  const k = ms > 0 ? 1 - Math.exp(-dt / ms) : 1;
  return was + (target - was) * k;
}

/**
 * Writes into `out` the ghost each of the board's dots shows from `shown`, its brightness per
 * light with the dots first; a dot already brighter than its ghost shows no ghost.
 */
export function ghosts(b: Board, shown: Float64Array, ghost: Ghost, out: Float64Array): void {
  const row = ghost.row ?? 0;
  const col = ghost.col ?? 0;
  out.fill(0, 0, b.dots.length);
  if (row <= 0 && col <= 0) return;
  const rows = new Float64Array(b.rows);
  const cols = new Float64Array(b.cols);
  for (let i = 0; i < b.dots.length; i++) {
    const v = shown[i] ?? 0;
    const y = Math.floor(i / b.cols);
    const x = i % b.cols;
    rows[y] = (rows[y] as number) + v;
    cols[x] = (cols[x] as number) + v;
  }
  for (let i = 0; i < b.dots.length; i++) {
    const v = shown[i] ?? 0;
    const y = Math.floor(i / b.cols);
    const x = i % b.cols;
    const across = b.cols > 1 ? ((rows[y] as number) - v) / (b.cols - 1) : 0;
    const down = b.rows > 1 ? ((cols[x] as number) - v) / (b.rows - 1) : 0;
    out[i] = Math.max(0, Math.min(1, row * across + col * down) - v);
  }
}

/** The mix's columns for each light, in the order the sign was given them; `tint` holds four per light. */
export interface SignColumns {
  lit: Float64Array;
  gain: Float64Array;
  tint: Float64Array;
  hue: Float64Array;
  chroma: Float64Array;
  glow: Float64Array;
  invert: Float64Array;
}

/** The sign's channels, in the order the GPU side gathers them. */
export const CHANNELS = ['lit', 'gain', 'tint', 'hue', 'chroma', 'glow', 'invert'] as const;

/** Numbers per light a channel holds: four for `tint`, one for the rest. */
export const axesOf = (c: keyof SignColumns): number => (c === 'tint' ? 4 : 1);

/** How lit a dot shows: `lit`, clamped to 0..1, swapped `invert` of the way toward dark or lit. */
export function shownLit(lit: number, invert: number): number {
  const on = Math.min(Math.max(lit, 0), 1);
  return on + Math.min(Math.max(invert, 0), 1) * (1 - 2 * on);
}
