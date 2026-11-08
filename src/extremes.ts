import { kindOf, lerpNumber, type NumberOptions } from './channels.js';
import { shared } from './shared.js';
import type { Channel } from './types.js';

/** What `min`, `norm`, and the number blend modes `screen` and `darken` made, keyed by the channel itself, so another engine can trust its math. */
export type Extreme =
  | { readonly op: 'min'; readonly top: number }
  | { readonly op: 'norm'; readonly power: number }
  | { readonly op: 'screen' };

export const extremes = shared<object, Extreme>('extreme@1');

/** The arithmetic of a channel `min` or `norm` made; undefined for any other. */
export function extremeOf(channel: Channel<unknown>): Extreme | undefined {
  return extremes.get(channel);
}

/**
 * A number where the smallest contribution wins, resting at the top of its bounds, or at 1 without
 * any.
 *
 * A weight fades a contribution toward that rest before the comparison, so a fading voice gives way
 * once another's value falls below its faded one. For a clip or reveal radius, a speed limit, any
 * value where the most restrictive voice should decide. `darken` is this resting at 1.
 *
 * @category channel
 */
export function min(opts?: NumberOptions): Channel<number> {
  const bounds = opts?.bounds;
  const top = bounds?.[1] ?? 1;
  if (!Number.isFinite(top))
    throw new RangeError(`blits: min rests at its top bound, which has to be finite, not ${top}`);
  const channel: Channel<number> = {
    kind: kindOf('min', bounds),
    bounds,
    rest: top,
    merge: (a, b) => (a < b ? a : b),
    scale: (v, w) => top + (v - top) * w,
    lerp: lerpNumber,
  };
  extremes.set(channel, { op: 'min', top });
  return channel;
}

/**
 * What `norm` takes.
 *
 * @category channel
 */
export interface NormOptions extends NumberOptions {
  /**
   * How close the fold is to `max`: at 1 the contributions add, as `sum` does; the higher it goes,
   * the more the largest decides. Default 2. At least 1, and finite.
   */
  power?: number;
}

/**
 * A number whose contributions combine between adding and taking the largest, resting at 0: the
 * `power`-th root of the sum of their `power`-th powers, each keeping its sign. Two voices at 1 give
 * 2 under `sum` and 1 under `max`, and √2 here at the default power of 2. One voice alone gives its
 * own value, and the result is smooth as one overtakes another, where `max` has a corner. A weight
 * scales a contribution toward 0 first. For overlapping lights, glows and intensities that should
 * build up a little but not pile up.
 *
 * @category channel
 */
export function norm(opts?: NormOptions): Channel<number> {
  const p = opts?.power ?? 2;
  if (!(p >= 1 && Number.isFinite(p)))
    throw new RangeError(`blits: norm takes a finite power of at least 1, not ${p}`);
  const up = (v: number) => (v < 0 ? -((-v) ** p) : v ** p);
  const down = (s: number) => (s < 0 ? -((-s) ** (1 / p)) : s ** (1 / p));
  const channel: Channel<number> = {
    kind: kindOf(`norm(${p})`, opts?.bounds),
    bounds: opts?.bounds,
    rest: 0,
    merge: (a, b) => (a === 0 ? b : b === 0 ? a : down(up(a) + up(b))),
    scale: (v, w) => v * w,
    lerp: lerpNumber,
  };
  extremes.set(channel, { op: 'norm', power: p });
  return channel;
}
