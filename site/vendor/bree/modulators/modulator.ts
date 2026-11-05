import { type Patch, type WaveShape, waveAt } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import type { Placed } from '../orders.js';
import type { NumberParam, Params, Values } from '../params.js';
import type { Channel } from '../planes.js';
import type { ModShader, Ranked } from './shader.js';

/** One channel of the sign driven along a curve over time, phased over the sign by an order. */
export interface Modulator<P extends Params = Params> {
  readonly kind: 'modulator';
  readonly name: string;
  readonly about: string;
  readonly params: P;
  /** The channels `patch` writes, and no others. */
  readonly writes: readonly Channel[];
  /** What it plays on: the dots of the sign, or the three cells of the border. */
  readonly on: 'dots' | 'cells';
  /** Its duration is one cycle (or one pass). `rank` gives each subject a phase shift, never a start delay, so a loop has no warm-up. */
  patch(at: Placed, p: Values<P>, rank: (s: Subject) => number): Patch<Subject, Pose>;
  /**
   * The same cycle as a shader patch the gpu engine folds, on every dot and cell, reading its rank
   * from `rank` (the order and board width a closed-form spread gives, null for any other). Absent,
   * or giving null, where its math has no shader for that spread.
   */
  shader?(at: Placed, p: Values<P>, rank: Ranked | null): ModShader | null;
}

/** Declares a modulator, keeping its params' keys in the type `patch` sees. */
export const modulator = <P extends Params>(m: Omit<Modulator<P>, 'kind'>): Modulator<P> => ({
  kind: 'modulator',
  ...m,
});

/** Cycles per second of a looping modulator. */
export const RATE: NumberParam = {
  label: 'rate',
  min: 0.1,
  max: 10,
  step: 0.1,
  value: 1,
  unit: 'Hz',
  about: 'How many times a second the effect repeats. Higher is faster.',
};

/** How far a modulator swings its channel, as a fraction of its full range; `about` says what that does. */
export const depth = (value: number, about: string): NumberParam => ({
  label: 'depth',
  min: 0,
  max: 1,
  step: 0.01,
  value,
  about,
});

/** How much one rank of the order shifts a modulator's curve. */
export const phasePerStep = (value: number): NumberParam => ({
  label: 'phase per step',
  min: 0,
  max: 0.25,
  step: 0.005,
  value,
  unit: 'τ',
  about:
    'How far behind each step of the spread runs, in whole cycles (τ). At 0 every dot moves in time; higher sends a ripple across the sign.',
});

/** One cycle of a looping modulator at `rate`, in ms. */
export const cycleMs = (rate: number) => 1000 / rate;

/** A wave's value at `x` cycles as 0..1, starting where it is lowest or at its midpoint rising. */
export const unitAt = (shape: WaveShape, x: number) => (waveAt(shape, x) + 1) / 2;

/** A smooth hump: 1 at `d` 0, falling along a half cosine to 0 at `d` ±1 and beyond. */
export const bump = (d: number) => (Math.abs(d) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d));

/** How many times over `outweigh` counts a tint by default. */
export const OUTWEIGH = 3;

/**
 * A tint counted `by` times over in the color average, so a modulator's color outweighs the
 * scene's rather than meeting it halfway.
 */
export const outweigh = (tint: readonly number[], by = OUTWEIGH) => tint.map((v) => v * by);
