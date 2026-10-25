import { same } from './clock.js';
import type { Curve } from './easing.js';
import { eased, progress } from './tweened.js';

/** The closed forms a motion patch's law picks between, by its first number. */
export const UNDER = 0;
export const CRITICAL = 1;
export const OVER = 2;
export const COAST = 3;
export const EASED = 4;
export const BOUND = 5;

const solved = { y: 0, dy: 0 };

/**
 * The terms of a stretch that depend only on how long since its release, the same on every axis, so
 * a sample works them out once rather than once per axis.
 */
const timed = { e: 0, e2: 0, cos: 0, sin: 0 };

/** The law and time `timed` was last worked out for: subjects released together share them. */
const prepared = {
  form: Number.NaN,
  k1: Number.NaN,
  k2: Number.NaN,
  k3: Number.NaN,
  t: Number.NaN,
};

/** `t` seconds after release, the terms every axis shares, into `timed`. */
function prepare(law: Float64Array, t: number): void {
  const form = law[0] as number;
  const k1 = law[2] as number;
  const k2 = law[3] as number;
  const k3 = law[4] as number;
  const p = prepared;
  if (same(t, p.t) && form === p.form && k1 === p.k1 && k2 === p.k2 && k3 === p.k3) return;
  p.form = form;
  p.k1 = k1;
  p.k2 = k2;
  p.k3 = k3;
  p.t = t;
  switch (form) {
    case UNDER: {
      const zeta = law[2] as number;
      const w0 = law[3] as number;
      const wd = law[4] as number;
      timed.e = Math.exp(-zeta * w0 * t);
      timed.cos = Math.cos(wd * t);
      timed.sin = Math.sin(wd * t);
      return;
    }
    case CRITICAL: {
      const w0 = law[3] as number;
      timed.e = Math.exp(-w0 * t);
      return;
    }
    case OVER: {
      timed.e = Math.exp((law[2] as number) * t);
      timed.e2 = Math.exp((law[3] as number) * t);
      return;
    }
    default:
      timed.e = Math.exp(-t / (law[2] as number));
  }
}

/**
 * One axis, `t` seconds after release, `y0` from where it heads and moving at `v0`, into `solved`,
 * with `timed` prepared for `t`. Each form is a function of its own, small enough for V8 to inline
 * wherever `closed` is: as one switch over all four it was not, and spring fills ran at two speeds.
 */
function solve(law: Float64Array, y0: number, v0: number, t: number): void {
  const form = law[0];
  if (form === UNDER) solveUnder(law, y0, v0);
  else if (form === CRITICAL) solveCritical(law, y0, v0, t);
  else if (form === OVER) solveOver(law, y0, v0);
  else solveGlide(law, y0);
}

function solveUnder(law: Float64Array, y0: number, v0: number): void {
  const zeta = law[2] as number;
  const w0 = law[3] as number;
  const wd = law[4] as number;
  const e = timed.e;
  const b = (v0 + zeta * w0 * y0) / wd;
  const cos = timed.cos;
  const sin = timed.sin;
  const y = e * (y0 * cos + b * sin);
  solved.y = y;
  solved.dy = -zeta * w0 * y + e * wd * (b * cos - y0 * sin);
}

function solveCritical(law: Float64Array, y0: number, v0: number, t: number): void {
  const w0 = law[3] as number;
  const e = timed.e;
  const b = v0 + w0 * y0;
  const y = e * (y0 + b * t);
  solved.y = y;
  solved.dy = e * b - w0 * y;
}

function solveOver(law: Float64Array, y0: number, v0: number): void {
  const r1 = law[2] as number;
  const r2 = law[3] as number;
  const a = (v0 - r2 * y0) / (r1 - r2);
  const b = y0 - a;
  const e1 = timed.e;
  const e2 = timed.e2;
  solved.y = a * e1 + b * e2;
  solved.dy = a * r1 * e1 + b * r2 * e2;
}

/**
 * Released at x moving at v, a glide comes to rest at x + v·τ; y is the distance still to go,
 * which friction closes as e^(−t/τ), and its derivative at release is v again.
 */
function solveGlide(law: Float64Array, y0: number): void {
  const tau = law[2] as number;
  const e = timed.e;
  solved.y = y0 * e;
  solved.dy = (-y0 / tau) * e;
}

/**
 * A glide with bounds, heading for `goal`: the rest point itself where the coast stops inside them,
 * else the edge it springs back to. Which one is read off the stretch, so no stretch carries more
 * than an unbounded one: the coast's own rest, worked out as the glide's `aim` does, is `goal`
 * exactly when it stops inside; past it on the side `x0` is on too, the subject was let go past the
 * edge and springs back at once; else it coasts until it crosses the edge and springs from there,
 * at the speed it crossed at. The spring is critically damped, its ω₀ the law's `k2`.
 */
function solveBound(law: Float64Array, x0: number, goal: number, v0: number, t: number): void {
  const tau = law[2] as number;
  const y0 = x0 - goal;
  const over = x0 + v0 * tau - goal;
  if (over === 0) {
    solveGlide(law, y0);
    return;
  }
  const w0 = law[3] as number;
  if (y0 * over > 0) {
    const e = Math.exp(-w0 * t);
    const b = v0 + w0 * y0;
    const y = e * (y0 + b * t);
    solved.y = y;
    solved.dy = e * b - w0 * y;
    return;
  }
  // e^(−t/τ) where the coast meets the edge: the fraction of its speed it still has there.
  const left = 1 + y0 / (v0 * tau);
  const cross = left > 0 ? -tau * Math.log(left) : Number.POSITIVE_INFINITY;
  if (t < cross) {
    const e = timed.e;
    solved.y = y0 + v0 * tau * (1 - e);
    solved.dy = v0 * e;
    return;
  }
  const s = t - cross;
  const vc = v0 * left;
  const e = Math.exp(-w0 * s);
  solved.y = e * vc * s;
  solved.dy = e * vc * (1 - w0 * s);
}

/**
 * A stretch at voice time `t`, released at `at` from `x0` moving at `v0` toward `to` (each read
 * from its offset), into `xo` and `vo`: the one copy of the closed forms, which `law` (a patch's
 * `[form, settle, k1, k2, k3]`, the head of a patch's buffer or a copy of it) picks between. A tween reads `ease` and
 * `ms`, the stretch's length, dividing in milliseconds so a boundary lands exactly; every other
 * form ignores them.
 */
export function closed(
  law: Float64Array,
  ease: Curve | undefined,
  n: number,
  at: number,
  ms: number,
  x0: ArrayLike<number>,
  x: number,
  v0: ArrayLike<number>,
  v: number,
  to: ArrayLike<number>,
  g: number,
  t: number,
  xo: Float64Array,
  vo: Float64Array,
): boolean {
  if (law[0] === EASED)
    return eased(ease as Curve, n, progress(t, at, ms), ms, x0, x, to, g, xo, vo);
  const dt = Math.max(0, t - at) / 1000;
  const settle = law[1] as number;
  let still = settle > 0;
  prepare(law, dt);
  for (let i = 0; i < n; i++) {
    const goal = to[g + i] as number;
    if (law[0] === BOUND) solveBound(law, x0[x + i] as number, goal, v0[v + i] as number, dt);
    else solve(law, (x0[x + i] as number) - goal, v0[v + i] as number, dt);
    xo[i] = goal + solved.y;
    vo[i] = solved.dy;
    if (Math.abs(solved.y) > settle || Math.abs(solved.dy) > settle) still = false;
  }
  if (still)
    for (let i = 0; i < n; i++) {
      xo[i] = to[g + i] as number;
      vo[i] = 0;
    }
  return still;
}
