import { color, kit, mul, oklab, patch } from '@msb235/blits';

export interface Pose {
  gain: number;
  color: number[];
}
export interface Tile {
  i: number;
}

export const TILE = kit<Pose>({ gain: mul(), color: color() });

/** Loop lengths in ms; the pattern on show at any time is one of these. */
export const PERIODS = [4000, 7000, 11000];
const TINTS = [oklab(0x2f66d8), oklab(0xc23d7a), oklab(0x2fa86a)];
export const BURST_MS = 600;

export const patterns = PERIODS.map((period, p) => {
  const tint = TINTS[p] as number[];
  return patch<Tile, Pose>(
    period,
    (phase, t) => ({ gain: 0.6 + 0.4 * Math.sin(2 * Math.PI * phase + t.i * 0.013), color: tint }),
    { writes: ['gain', 'color'] },
  );
});

export const burst = patch<Tile, Pose>(
  BURST_MS,
  (phase) => ({ gain: 1 + 0.5 * Math.sin(Math.PI * phase) }),
  { writes: ['gain'] },
);
