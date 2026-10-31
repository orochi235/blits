import { color, kit, mul, oklab, patch } from '@msb235/blits';
import { rng } from '@stress/rng';

export interface Pose {
  gain: number;
  color: number[];
}
export interface Tile {
  i: number;
}

export const TILE = kit<Pose>({ gain: mul(), color: color() });

/** Loop lengths in ms before the seed stretches each by up to 10% either way. */
const PERIODS = [4000, 7000, 11000];
/** The clock loop's length before the seed: it plays the whole soak on subjects of its own. */
const CLOCK_MS = 9000;
const TINTS = [oklab(0x2f66d8), oklab(0xc23d7a), oklab(0x2fa86a), oklab(0xe8b33c)];
export const BURST_MS = 600;

const loop = (period: number, tint: number[]) => ({
  period,
  patch: patch<Tile, Pose>(
    period,
    (phase, t) => ({ gain: 0.6 + 0.4 * Math.sin(2 * Math.PI * phase + t.i * 0.013), color: tint }),
    { writes: ['gain', 'color'] },
  ),
});
export type Loop = ReturnType<typeof loop>;

/** The shows that take turns on the wall, and the clock loop, their lengths drawn from `seed`. */
export function loops(seed: number): { shows: Loop[]; clock: Loop } {
  const r = rng(seed ^ 0x27d4eb2f);
  const stretch = (ms: number) => ms * (0.9 + 0.2 * r.next());
  return {
    shows: PERIODS.map((ms, p) => loop(stretch(ms), TINTS[p] as number[])),
    clock: loop(stretch(CLOCK_MS), TINTS[3] as number[]),
  };
}

export const burst = patch<Tile, Pose>(
  BURST_MS,
  (phase) => ({ gain: 1 + 0.5 * Math.sin(Math.PI * phase) }),
  { writes: ['gain'] },
);
