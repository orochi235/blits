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
/** A spring with neither stiffness nor damping: it keeps the velocity it is given. */
export const DRIFT = 6;
/**
 * A glide whose bounds turn it back, keeping the law's `k3` of its speed at each edge. Its stretch
 * carries both edges of every axis, since a bounce may carry it to the far one.
 */
export const REFLECT = 7;

/** A bounded glide's law `k3` where an edge stops a coast that crosses it; 0 springs it back. */
export const STOP = 1;

/** The most edges a reflecting coast meets; at the last it stops, as its rest does. */
const BOUNCES = 256;

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
    case DRIFT:
      return;
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
  else if (form === DRIFT) solveDrift(y0, v0, t);
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
 * Nothing pulls or slows it, so it moves on at `v0`. A speed within settle was stopped when the
 * stretch was released (`Motions.moving`), so it never creeps and then snaps.
 */
function solveDrift(y0: number, v0: number, t: number): void {
  solved.y = y0 + v0 * t;
  solved.dy = v0;
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
    springBack(w0, y0, v0, t);
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
  if (law[4] === STOP) {
    solved.y = 0;
    solved.dy = 0;
    return;
  }
  const s = t - cross;
  const vc = v0 * left;
  const e = Math.exp(-w0 * s);
  solved.y = e * vc * s;
  solved.dy = e * vc * (1 - w0 * s);
}

/** A critically damped spring of ω₀ `w0` from `y0` off its goal at `v0`, `t` s on. */
function springBack(w0: number, y0: number, v0: number, t: number): void {
  const e = Math.exp(-w0 * t);
  const b = v0 + w0 * y0;
  const y = e * (y0 + b * t);
  solved.y = y;
  solved.dy = e * b - w0 * y;
}

/** Where `reflected` leaves a coast: its position and velocity. */
export const walked = { x: 0, v: 0 };

/**
 * A coast from `x0` at `v0` between `lo` and `hi`, `t` s on (Infinity for its rest), into
 * `walked`: each edge it reaches turns it back with `r` of the speed it met the edge at, and it
 * coasts on from there under the same friction. From outside the bounds it coasts in through the
 * near edge; `backs` says when it springs back instead.
 */
export function reflected(
  tau: number,
  r: number,
  lo: number,
  hi: number,
  x0: number,
  v0: number,
  t: number,
): void {
  let x = x0;
  let v = v0;
  let s = t;
  for (let i = 0; ; i++) {
    if (v === 0) break;
    if (i === BOUNCES) {
      v = 0;
      break;
    }
    const wall = v > 0 ? hi : lo;
    // e^(−t/τ) where the coast meets the wall: the fraction of its speed it still has there.
    const left = 1 - (wall - x) / (v * tau);
    if (!(left > 0)) break;
    const cross = -tau * Math.log(left);
    if (s < cross) break;
    s -= cross;
    x = wall;
    v = -r * v * left;
  }
  const e = s === Number.POSITIVE_INFINITY ? 0 : Math.exp(-s / tau);
  walked.x = x + v * tau * (1 - e);
  walked.v = v * e;
}

/** Whether a reflecting coast let go at `x0`, past an edge, springs back rather than coasting in. */
export function backs(tau: number, lo: number, hi: number, x0: number, v0: number): boolean {
  if (x0 < lo) return !(x0 + v0 * tau > lo);
  if (x0 > hi) return !(x0 + v0 * tau < hi);
  return false;
}

/** One axis of a reflecting glide heading for `goal`, its edges `lo` and `hi`, into `solved`. */
function solveReflect(
  law: Float64Array,
  x0: number,
  goal: number,
  v0: number,
  lo: number,
  hi: number,
  t: number,
): void {
  const tau = law[2] as number;
  if (backs(tau, lo, hi, x0, v0)) {
    springBack(law[3] as number, x0 - goal, v0, t);
    return;
  }
  reflected(tau, law[4] as number, lo, hi, x0, v0, t);
  solved.y = walked.x - goal;
  solved.dy = walked.v;
}

/**
 * A stretch at voice time `t`, released at `at` from `x0` moving at `v0` toward `to` (each read
 * from its offset), into `xo` and `vo`: the one copy of the closed forms, which `law` (a patch's
 * `[form, settle, k1, k2, k3]`, the head of a patch's buffer or a copy of it) picks between. A tween reads `ease` and
 * `ms`, the stretch's length, dividing in milliseconds so a boundary lands exactly; every other
 * form ignores them. A reflecting glide reads each axis's edges from `edges` at `e`: every axis's
 * least edge, then every axis's greatest.
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
  edges?: ArrayLike<number>,
  e = 0,
): boolean {
  if (law[0] === EASED)
    return eased(ease as Curve, n, progress(t, at, ms), ms, x0, x, to, g, xo, vo);
  const dt = Math.max(0, t - at) / 1000;
  // A negative settle holds the distance and the speed each as one length over the axes.
  const by = law[1] as number;
  const length = by < 0;
  const settle = length ? -by : by;
  let still = settle > 0;
  let far = 0;
  let fast = 0;
  prepare(law, dt);
  for (let i = 0; i < n; i++) {
    const goal = to[g + i] as number;
    if (law[0] === BOUND) solveBound(law, x0[x + i] as number, goal, v0[v + i] as number, dt);
    else if (law[0] === REFLECT) {
      const lo = (edges as ArrayLike<number>)[e + i] as number;
      const hi = (edges as ArrayLike<number>)[e + n + i] as number;
      solveReflect(law, x0[x + i] as number, goal, v0[v + i] as number, lo, hi, dt);
    } else solve(law, (x0[x + i] as number) - goal, v0[v + i] as number, dt);
    xo[i] = goal + solved.y;
    vo[i] = solved.dy;
    if (length) {
      far += solved.y * solved.y;
      fast += solved.dy * solved.dy;
    } else if (Math.abs(solved.y) > settle || Math.abs(solved.dy) > settle) still = false;
  }
  if (length && (Math.sqrt(far) > settle || Math.sqrt(fast) > settle)) still = false;
  if (still)
    for (let i = 0; i < n; i++) {
      xo[i] = to[g + i] as number;
      vo[i] = 0;
    }
  return still;
}
