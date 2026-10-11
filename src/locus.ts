import { first } from './clone.js';
import type { Mixer } from './mixer.js';
import type { Channel } from './types.js';
import type { Subject, Voice } from './voice.js';

/**
 * What a fold with a locus in play gathers, kept from one fold to the next: the contributions in
 * voice order, each a voice's own or a locus's first member; every locus member; and per channel
 * slot, a locus's folding value, the weight taken into it and the array it owns.
 */
export interface LocusScratch<I, O> {
  n: number;
  voices: (Voice<I, O> | null)[];
  helds: (Subject<unknown> | null)[];
  deltas: (Record<string, unknown> | null)[];
  weights: number[];
  /** Per contribution, -1 for a voice's own, or which of `names` it is. */
  groups: number[];
  names: string[];
  m: number;
  mVoices: (Voice<I, O> | null)[];
  mDeltas: (Record<string, unknown> | null)[];
  mWeights: number[];
  mGroups: number[];
  values: unknown[];
  taken: Float64Array;
  /** Per slot of a stock `last` channel, the weight of the member its value came from. */
  heaviest: Float64Array;
  met: Uint8Array;
  touched: number[];
  owned: (number[] | undefined)[];
}

export function locusScratch<I, O>(channels: number): LocusScratch<I, O> {
  return {
    n: 0,
    voices: [],
    helds: [],
    deltas: [],
    weights: [],
    groups: [],
    names: [],
    m: 0,
    mVoices: [],
    mDeltas: [],
    mWeights: [],
    mGroups: [],
    values: new Array(channels).fill(undefined),
    taken: new Float64Array(channels),
    heaviest: new Float64Array(channels),
    met: new Uint8Array(channels),
    touched: [],
    owned: new Array(channels).fill(undefined),
  };
}

/**
 * `value` copied into the array `k` owns for the slot, as long as the channel's rest, where a
 * shorter value leaves the rest's own fill: what the channel's fold and lerp read past its end.
 */
export function own<I, O>(
  k: LocusScratch<I, O>,
  slot: number,
  value: number[],
  rest: number[],
): number[] {
  let out = k.owned[slot];
  if (out === undefined) {
    out = rest.slice();
    k.owned[slot] = out;
  }
  for (let i = 0; i < out.length; i++)
    out[i] = i < value.length ? (value[i] as number) : (rest[i] as number);
  return out;
}

/**
 * Folds one locus's members into one contribution through each channel's own `lerp`: its value per
 * channel goes in `k.values`, the channels in `k.touched` in the order first met, and its weight
 * is returned. A stock `last` channel has nothing to lerp, so it takes its heaviest member's value,
 * the later cued of two as heavy. A channel folding by scale takes its value in an array of `k`'s own, lerped in
 * place, since the fold only reads it.
 */
export function foldLocus<I, O>(this: Mixer<I, O>, k: LocusScratch<I, O>, group: number): number {
  k.touched.length = 0;
  let sum = 0;
  for (let m = 0; m < k.m; m++) if (k.mGroups[m] === group) sum += k.mWeights[m] as number;
  if (sum <= 0) return 0;
  const taken = k.taken;
  for (let m = 0; m < k.m; m++) {
    if (k.mGroups[m] !== group) continue;
    const weight = k.mWeights[m] as number;
    if (weight <= 0) continue;
    const delta = k.mDeltas[m] as Record<string, unknown>;
    const slots = (k.mVoices[m] as Voice<I, O>).slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as number;
      const value = delta[this.names[slot] as string];
      if (value === undefined) continue;
      const channel = this.channels[slot] as Channel<unknown>;
      if (k.met[slot] === 0) {
        k.met[slot] = 1;
        k.touched.push(slot);
        taken[slot] = weight;
        k.heaviest[slot] = weight;
        k.values[slot] =
          this.lerpsInto[slot] !== undefined && channel.scale && Array.isArray(value)
            ? own(k, slot, value, channel.rest as number[])
            : first(value);
        continue;
      }
      const total = (taken[slot] as number) + weight;
      taken[slot] = total;
      if (channel.kind === 'last') {
        if (weight >= (k.heaviest[slot] as number)) {
          k.heaviest[slot] = weight;
          k.values[slot] = first(value);
        }
        continue;
      }
      const was = k.values[slot];
      const lerp = this.lerpsInto[slot];
      k.values[slot] =
        lerp !== undefined && was === k.owned[slot]
          ? lerp(was as unknown[], was, value, weight / total)
          : channel.lerp(was, value, weight / total);
    }
  }
  for (let t = 0; t < k.touched.length; t++) k.met[k.touched[t] as number] = 0;
  return sum > 1 ? 1 : sum;
}
