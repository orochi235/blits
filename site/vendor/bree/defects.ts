import type { Board, Led } from './board.js';
import { hash } from './hash.js';

/**
 * A fault in one light, which the sign shows whatever the mix asks of it: `dead` never lights,
 * `dim` lights at `gain` of its proper brightness, `flicker` drops out at random about `rate`
 * times a second and is lit for `duty` of the time, and `stuck` stays lit at `level` or more.
 */
export type Fault =
  | { readonly kind: 'dead' }
  | { readonly kind: 'dim'; readonly gain: number }
  | { readonly kind: 'flicker'; readonly rate?: number; readonly duty?: number }
  | { readonly kind: 'stuck'; readonly level?: number };

export type FaultKind = Fault['kind'];

/** A dot by its column and row, or a bulb of the border by its place in `board.bulbs`. */
export type Where = { readonly x: number; readonly y: number } | { readonly bulb: number };

/** A fault and the light it is in. */
export type Defect = Fault & { readonly at: Where };

const FLICKER_RATE = 6;
const FLICKER_DUTY = 0.6;
const DIM_GAIN = 0.3;
/** The hash's third input for a flicker, so it rolls apart from other effects' randomness. */
export const FLICKER_SEED = 7;

/** Each fault's effect per light, in the order the sign was given its lights. */
export interface Afflictions {
  /** What a light's brightness is multiplied by: 0 dead, below 1 dim. */
  readonly scale: Float64Array;
  /** The least a light shows: above 0 when stuck. */
  readonly floor: Float64Array;
  /** How often a flickering light changes, per second; 0 when it does not flicker. */
  readonly rate: Float64Array;
  /** How much of the time a flickering light is lit. */
  readonly duty: Float64Array;
}

/** Afflictions for `leds` from `defects`; a defect naming no light is left out, and a later one on a light wins. */
export function afflictions(leds: readonly Led[], defects: readonly Defect[]): Afflictions {
  const n = leds.length;
  const out: Afflictions = {
    scale: new Float64Array(n).fill(1),
    floor: new Float64Array(n),
    rate: new Float64Array(n),
    duty: new Float64Array(n).fill(1),
  };
  const index = new Map<string, number>();
  leds.forEach((led, i) => {
    index.set(led.kind === 'dot' ? `${led.x},${led.y}` : `bulb ${led.i}`, i);
  });
  for (const d of defects) {
    const i = index.get('bulb' in d.at ? `bulb ${d.at.bulb}` : `${d.at.x},${d.at.y}`);
    if (i === undefined) continue;
    out.scale[i] = 1;
    out.floor[i] = 0;
    out.rate[i] = 0;
    out.duty[i] = 1;
    if (d.kind === 'dead') out.scale[i] = 0;
    else if (d.kind === 'dim') out.scale[i] = Math.min(Math.max(d.gain, 0), 1);
    else if (d.kind === 'stuck') out.floor[i] = Math.min(Math.max(d.level ?? 1, 0), 1);
    else {
      out.rate[i] = Math.max(d.rate ?? FLICKER_RATE, 0);
      out.duty[i] = Math.min(Math.max(d.duty ?? FLICKER_DUTY, 0), 1);
    }
  }
  return out;
}

/** What light `i` shows at `ms` when the mix asks `want` of it, 0 to 1. */
export function afflict(a: Afflictions, i: number, want: number, ms: number): number {
  let v = want * (a.scale[i] ?? 1);
  const rate = a.rate[i] ?? 0;
  if (rate > 0 && hash(i, Math.floor((ms / 1000) * rate), FLICKER_SEED) >= (a.duty[i] ?? 1)) v = 0;
  return Math.max(v, a.floor[i] ?? 0);
}

/**
 * Faults scattered over the sign's dots: each kind in `share` of them, picked by `seed` so the same
 * seed breaks the same dots. Kinds take turns per dot, so the shares add up and never overlap.
 */
export function scatter(b: Board, share: Partial<Record<FaultKind, number>>, seed = 1): Defect[] {
  const kinds = (['dead', 'dim', 'flicker', 'stuck'] as const).filter((k) => (share[k] ?? 0) > 0);
  const out: Defect[] = [];
  for (const dot of b.dots) {
    if (dot.kind !== 'dot') continue;
    let roll = hash(dot.x, dot.y, seed * 31 + 3);
    for (const kind of kinds) {
      const p = share[kind] ?? 0;
      if (roll < p) {
        const at = { x: dot.x, y: dot.y };
        const shade = hash(dot.x, dot.y, seed * 31 + 5);
        if (kind === 'dim') out.push({ kind, at, gain: DIM_GAIN * (0.5 + shade) });
        else if (kind === 'flicker') out.push({ kind, at, rate: FLICKER_RATE * (0.5 + shade) });
        else out.push({ kind, at });
        break;
      }
      roll -= p;
    }
  }
  return out;
}
