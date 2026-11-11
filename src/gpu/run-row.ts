import { BOUND } from '../closed.js';
import type { Motions } from '../motions.js';
import type { Segment } from '../stretch.js';
import { join } from './region.js';
import { BRANCH_SHIFT, Branch } from './wgsl/closed.js';

/**
 * Writes `seg` as a subject's run at `o` in `rows`, its release time counted from `anchor`. A
 * bounded glide's branch on each axis is decided here in f64, as the CPU decides it, and carried
 * in the flags word: f32 could take a different one.
 */
export function putRun<I>(
  rows: Float32Array,
  o: number,
  motions: Motions<I>,
  flags: number,
  seg: Segment,
  anchor: number,
): void {
  const n = motions.n;
  const law = motions.shape.law;
  let word = flags;
  if (law[0] === BOUND) {
    const tau = law[2] as number;
    for (let i = 0; i < n; i++) {
      const x0 = seg.x0[i] as number;
      const goal = seg.to[i] as number;
      const y0 = x0 - goal;
      const over = x0 + (seg.v0[i] as number) * tau - goal;
      const branch = over === 0 ? Branch.COAST : y0 * over > 0 ? Branch.BACK : Branch.CROSS;
      word += branch * 2 ** (BRANCH_SHIFT + 2 * i);
    }
  }
  rows[o] = seg.at - anchor;
  rows[o + 1] = word;
  rows[o + 2] = seg.ms;
  for (let i = 0; i < n; i++) {
    rows[o + 3 + i] = seg.x0[i] as number;
    rows[o + 3 + n + i] = seg.v0[i] as number;
    rows[o + 3 + 2 * n + i] = seg.to[i] as number;
  }
}

/** Rows `dirty`, `bytes` apiece, as sorted `[start, end)` byte ranges, touching ones joined. */
export function rangesOf(dirty: Iterable<number>, bytes: number): [number, number][] {
  const out: [number, number][] = [];
  for (const row of [...dirty].sort((a, b) => a - b)) join(out, row * bytes, (row + 1) * bytes);
  return out;
}

/** Sorted, joined byte ranges `out` with `[from, to)` among them, joined where they touch. */
export function spliced(out: [number, number][], from: number, to: number): [number, number][] {
  const all: [number, number][] = [];
  let placed = false;
  for (const [a, b] of out) {
    if (!placed && from <= a) {
      join(all, from, to);
      placed = true;
    }
    join(all, a, b);
  }
  if (!placed) join(all, from, to);
  return all;
}
