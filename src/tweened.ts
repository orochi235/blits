import type { Curve } from './easing.js';

/** How far a tween's slope is read either side of `u`, for an easing that is only a function. */
const SPAN = 1e-4;
/**
 * Whether an evaluation wants a tween's velocity, which costs two more reads of its easing. Only
 * `read` asks for it; a mix and a retarget never use it.
 */
let slope = false;
/** The last tween sample's time, curve and length, and the share of the way it had left to go. */
const memo = { u: Number.NaN, ease: undefined as Curve | undefined, left: 0 };

/** Turns the velocity `eased` works out on or off. */
export function sloped(on: boolean): void {
  slope = on;
}

/** How far through a stretch released at `at` and lasting `ms` voice time `t` is, from 0. */
export function progress(t: number, at: number, ms: number): number {
  return Math.max(0, t - at) / ms;
}

/** The share of a tween's way left to go at `u`, 0 once it has arrived. */
export function left(ease: Curve, u: number): number {
  // Subjects released together share `u`, so a frame reads a bezier once, not once each.
  if (u !== memo.u || ease !== memo.ease) {
    memo.u = u;
    memo.ease = ease;
    memo.left = u >= 1 ? 0 : 1 - ease(u);
  }
  return memo.left;
}

/** An axis of a tween from `x0` to `goal` with `share` of the way left. */
export function between(x0: number, goal: number, share: number): number {
  return share === 0 ? goal : goal + (x0 - goal) * share;
}

/** A tween's stretch at `u` into `xo` and `vo`: true once it has arrived. */
export function eased(
  ease: Curve,
  n: number,
  u: number,
  ms: number,
  x0: ArrayLike<number>,
  x: number,
  to: ArrayLike<number>,
  g: number,
  xo: Float64Array,
  vo: Float64Array,
): boolean {
  const share = left(ease, u);
  let rate = 0;
  if (slope && u < 1) {
    const lo = Math.max(0, u - SPAN);
    const hi = Math.min(1, u + SPAN);
    rate = ((ease(hi) - ease(lo)) / (hi - lo)) * (1000 / ms);
  }
  for (let i = 0; i < n; i++) {
    const a = x0[x + i] as number;
    const goal = to[g + i] as number;
    xo[i] = between(a, goal, share);
    vo[i] = -(a - goal) * rate;
  }
  return share === 0;
}
