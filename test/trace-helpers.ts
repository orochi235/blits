import { expect } from 'vitest';
import { kit, max, mul, sum } from '../src/channels.js';
import type { Mix, Run } from '../src/types.js';

export interface Pose {
  x: number;
  gain: number;
  top: number;
  clip: number;
}
export const K = kit<Pose>({ x: sum(), gain: mul(), top: max(), clip: sum({ bounds: [0, 5] }) });
export interface Part {
  id: string;
}

/** The run's value at `t`, along its lines and bends; at a jump, the value after it. */
export function along(run: Run, t: number): number {
  const { at, value } = run;
  for (let i = at.length - 1; i >= 0; i--) {
    if ((at[i] as number) > t) continue;
    if ((at[i] as number) === t || i === at.length - 1) return value[i] as number;
    const a = at[i] as number;
    const b = at[i + 1] as number;
    const va = value[i] as number;
    const u = (t - a) / (b - a);
    const off = run.bends?.find((bend) => bend.index === i)?.off(u) ?? 0;
    return va + ((value[i + 1] as number) - va) * u + off;
  }
  return value[0] as number;
}

/** Checks a run against `project` every `step` ms, away from its points by `margin`. */
export function matches(
  m: Mix<Part, Pose>,
  run: Run,
  s: Part,
  ch: keyof Pose,
  step = 1,
  margin = 1e-3,
) {
  const from = run.at[0] as number;
  const to = run.at[run.at.length - 1] as number;
  for (let t = from; t <= to; t += step) {
    if (run.at.some((a) => Math.abs(a - t) < margin)) continue;
    expect(along(run, t)).toBeCloseTo(m.project(t).probe(s)[ch], 6);
  }
  for (let i = 0; i < run.at.length; i++) {
    const t = run.at[i] as number;
    // At a jump the first value is where the line before arrives, which `project` does not read.
    if (run.at[i + 1] === t) continue;
    if (t === to && run.at[i - 1] !== t && t > from) continue;
    expect(run.value[i]).toBeCloseTo(m.project(t).probe(s)[ch], 6);
  }
}

/** A seeded generator, so a failing scene comes back the same. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
