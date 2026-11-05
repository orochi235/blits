import { type Align, type DisplayType, fitCells, type SegShape } from '../type.js';

export { bar, disc, light } from './bars.js';

export type Point = readonly [number, number];

/** 0 to n - 1. */
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** A bent stroke through `points`, `w` wide. */
export const poly = (points: readonly Point[], w: number): SegShape => ({
  kind: 'poly',
  points,
  w,
});

/**
 * Points along an elliptical arc from `a0` to `a1` degrees, y down (90° is straight below the
 * center), sampled at most 6° apart.
 */
export function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
): Point[] {
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 6));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const;
  });
}

/** Points along a quadratic curve from `p0` to `p2` pulled toward `c`. */
export function curve(p0: Point, c: Point, p2: Point, steps = 12): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1],
    ] as const;
  });
}

/** Runs of points joined into one path, dropping a run's first point where it repeats the last. */
export function path(...runs: readonly (readonly Point[])[]): Point[] {
  const out: Point[] = [];
  for (const run of runs)
    for (const p of run) {
      const last = out.at(-1);
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-6) continue;
      out.push(p);
    }
  return out;
}

/** A whole number of zero or more given as a number or numeric string, or undefined. */
export function count(value: string | number): number | undefined {
  const n = typeof value === 'number' ? value : value.trim() === '' ? Number.NaN : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** A number's digits in `base`, most significant first; zero is one digit. */
export function digits(n: number, base: number): number[] {
  const out = [n % base];
  for (let rest = Math.floor(n / base); rest > 0; rest = Math.floor(rest / base))
    out.unshift(rest % base);
  return out;
}

/** Every cell blank. */
export const blanks = (cells: number): Set<string>[] =>
  Array.from({ length: cells }, () => new Set<string>());

/**
 * An encoder writing a whole number in `base`, a digit per cell, each digit's lights given by
 * `lit(digit, place)` with place 0 the last cell. Anything but a whole number shows blank.
 */
export function placeEncoder(
  base: number,
  lit: (digit: number, place: number) => readonly string[],
): DisplayType['encode'] {
  return (value, cells, align: Align) => {
    const n = count(value);
    if (n === undefined) return blanks(cells);
    const ds = digits(n, base);
    const out = ds.map((d, i) => new Set(lit(d, ds.length - 1 - i)));
    return fitCells(out, cells, align, new Set<string>());
  };
}
