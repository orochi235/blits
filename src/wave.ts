import { patch } from './patch.js';
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
  /** Peak swing per channel, either side of the channel's rest. Its keys are the patch's writes,
   *  and only a channel holding a number can take one. */
  depth: { [K in keyof O as NonNullable<O[K]> extends number ? K : never]?: number };
  /** The channels this wave was written against, which `cue` checks a mix's kit against. Each
   *  channel swings around its rest here, so a `mul` channel pulses around 1; without it, around 0. */
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

/** A wave's options worked out once: what each call of `at` reads. */
interface Plan {
  shape: WaveShape;
  cycles: number;
  start: number;
  writes: string[];
  depths: number[];
  rests: number[];
}

const plans = new WeakMap<object, Plan>();

function planOf<O>(opts: WaveOptions<O>): Plan {
  let plan = plans.get(opts);
  if (plan === undefined) {
    const depth: Record<string, number | undefined> = opts.depth;
    const writes = Object.keys(depth);
    plan = {
      shape: opts.shape ?? 'sine',
      cycles: opts.cycles ?? 1,
      start: opts.phase ?? 0,
      writes,
      depths: writes.map((c) => depth[c] as number),
      rests: writes.map((c) => {
        const rest = opts.kit?.[c as keyof O]?.rest;
        return typeof rest === 'number' ? rest : 0;
      }),
    };
    plans.set(opts, plan);
  }
  return plan;
}

/**
 * A periodic swing on each channel `depth` names, around its rest: an LFO for a bob, a sway or a
 * pulse. An `fn` patch that keeps its options on `patch.wave`, for an engine reading the wave
 * rather than calling it.
 *
 * @category patch
 */
export function wave<I, O>(duration: number, opts: WaveOptions<O>): Patch<I, O, void> {
  const own = planOf(opts);
  const made = patch<I, O, void>(
    duration,
    // A copy of the patch carries this `at` with a `wave` of its own, which it is read by.
    function at(this: Patch<I, O, void>, phase) {
      const plan = this.wave === opts ? own : planOf(this.wave as WaveOptions<O>);
      const unit = waveAt(plan.shape, phase * plan.cycles + plan.start);
      const out: Record<string, number> = {};
      for (let i = 0; i < plan.writes.length; i++)
        out[plan.writes[i] as string] =
          (plan.rests[i] as number) + (plan.depths[i] as number) * unit;
      return out as Partial<O>;
    },
    { writes: own.writes as (keyof O)[], kit: opts.kit },
  );
  return { ...made, wave: opts };
}
