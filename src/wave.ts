import { patch } from './patch.js';
import { shared } from './shared.js';
import type { Kit, Patch } from './types.js';

/**
 * The shape of one cycle of a `wave`.
 *
 * @category patch
 */
export type WaveShape = 'sine' | 'triangle' | 'saw' | 'square';

/**
 * What `wave` takes besides its duration.
 *
 * @category patch
 */
export interface WaveOptions<O> {
  /** Default 'sine'. */
  shape?: WaveShape;
  /** Whole or fractional cycles per pass of the patch's duration. Default 1. */
  cycles?: number;
  /** Where in its cycle the wave starts, 0..1. Default 0. */
  phase?: number;
  /** Peak value per channel; the wave swings between -depth and +depth. Its keys are the patch's writes. */
  depth: { [K in keyof O]?: number };
  /** The channels this wave was written against, which `cue` checks a mix's kit against. */
  kit?: Partial<Kit<O>>;
}

/**
 * The unit wave: -1..1 at `x` cycles, starting at 0 and rising (square: +1 for the first half).
 *
 * @category patch
 */
export function waveAt(shape: WaveShape, x: number): number {
  const u = x - Math.floor(x);
  switch (shape) {
    case 'sine':
      return Math.sin(2 * Math.PI * u);
    case 'triangle':
      return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4;
    case 'saw':
      return u < 0.5 ? 2 * u : 2 * u - 2;
    case 'square':
      return u < 0.5 ? 1 : -1;
  }
}

const options = shared<Patch<never, never, never>, WaveOptions<unknown>>('wave-options@1');

/** The options a `wave` patch was built with, for an engine reading the wave rather than calling it. */
export function waveOptionsOf<I, O, S>(p: Patch<I, O, S>): WaveOptions<O> | undefined {
  return options.get(p as unknown as Patch<never, never, never>) as WaveOptions<O> | undefined;
}

/**
 * A periodic swing on each channel `depth` names, around 0: an LFO for a bob, a sway or a pulse.
 *
 * @category patch
 */
export function wave<I, O>(duration: number, opts: WaveOptions<O>): Patch<I, O, void> {
  const shape = opts.shape ?? 'sine';
  const cycles = opts.cycles ?? 1;
  const start = opts.phase ?? 0;
  const writes = Object.keys(opts.depth) as (keyof O)[];
  const depths = writes.map((c) => opts.depth[c] as number);
  const p = patch<I, O, void>(
    duration,
    (phase) => {
      const unit = waveAt(shape, phase * cycles + start);
      const out: Partial<O> = {};
      for (let i = 0; i < writes.length; i++)
        out[writes[i] as keyof O] = ((depths[i] as number) * unit) as O[keyof O];
      return out;
    },
    { writes, kit: opts.kit },
  );
  options.set(p as unknown as Patch<never, never, never>, opts as WaveOptions<unknown>);
  return p;
}
