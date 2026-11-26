import { COAST, closed, DRIFT } from './closed.js';
import type { Curve } from './easing.js';
import { shortWay } from './turns.js';

type Out = { [i: number]: number };

/**
 * A matrix's parts, `[x, y, rotate, shear, scaleX, scaleY]`: the translation, the rotation, then
 * the scaled axes, x along `scaleX` and y `shear` along x and `scaleY` across it. `shear` is an
 * amount, not CSS's ratio to `scaleY`, so a y axis lying along x survives where `scaleY` is 0. A
 * flip lands in `scaleY`, and a matrix with no extent along x takes its rotation from its y axis.
 */
export function parts<T extends Out>(out: T, m: ArrayLike<number>, i = 0): T {
  const a = m[i] as number;
  const b = m[i + 1] as number;
  const c = m[i + 2] as number;
  const d = m[i + 3] as number;
  const sx = Math.hypot(a, b);
  const angle = sx === 0 ? Math.atan2(-c, d) : Math.atan2(b, a);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out[0] = m[i + 4] as number;
  out[1] = m[i + 5] as number;
  out[2] = angle;
  out[3] = cos * c + sin * d;
  out[4] = sx;
  out[5] = -sin * c + cos * d;
  return out;
}

/** The matrix with `parts` `[x, y, rotate, shear, scaleX, scaleY]`, written into `out`. */
export function compose<T extends Out>(out: T, p: ArrayLike<number>): T {
  const angle = p[2] as number;
  const k = p[3] as number;
  const sx = p[4] as number;
  const sy = p[5] as number;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out[0] = cos * sx;
  out[1] = sin * sx;
  out[2] = cos * k - sin * sy;
  out[3] = sin * k + cos * sy;
  out[4] = p[0] as number;
  out[5] = p[1] as number;
  return out;
}

/** The rate of `parts` at `m` (from `i`) moving at `dm` (from `j`), into `out`, with `p` its parts. */
function partsRate(
  out: Float64Array,
  m: ArrayLike<number>,
  i: number,
  dm: ArrayLike<number>,
  j: number,
  p: Float64Array,
): void {
  const a = m[i] as number;
  const b = m[i + 1] as number;
  const c = m[i + 2] as number;
  const d = m[i + 3] as number;
  const da = dm[j] as number;
  const db = dm[j + 1] as number;
  const dc = dm[j + 2] as number;
  const dd = dm[j + 3] as number;
  const angle = p[2] as number;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sx = p[4] as number;
  let turn: number;
  let grow: number;
  if (sx > 0) {
    turn = (a * db - b * da) / (sx * sx);
    grow = (a * da + b * db) / sx;
  } else {
    const r = c * c + d * d;
    turn = r > 0 ? (c * dd - d * dc) / r : 0;
    grow = cos * da + sin * db;
  }
  out[0] = dm[j + 4] as number;
  out[1] = dm[j + 5] as number;
  out[2] = turn;
  out[3] = cos * dc + sin * dd + turn * (p[5] as number);
  out[4] = grow;
  out[5] = -sin * dc + cos * dd - turn * (p[3] as number);
}

/** The rate of `compose` at parts `p` moving at `dp`, into `out`. */
function composeRate(out: Float64Array, p: Float64Array, dp: Float64Array): void {
  const angle = p[2] as number;
  const k = p[3] as number;
  const sx = p[4] as number;
  const sy = p[5] as number;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = dp[2] as number;
  const dk = dp[3] as number;
  const dsx = dp[4] as number;
  const dsy = dp[5] as number;
  out[0] = cos * dsx - sin * sx * turn;
  out[1] = sin * dsx + cos * sx * turn;
  out[2] = cos * dk - sin * dsy - turn * (sin * k + cos * sy);
  out[3] = sin * dk + cos * dsy + turn * (cos * k - sin * sy);
  out[4] = dp[0] as number;
  out[5] = dp[1] as number;
}

/**
 * Turns parts `p`, moving at `dp`, into whichever of the matrix's two forms lies nearer `goal`
 * along the rotation, shear and scales: `[θ, k, sx, sy]` and `[θ + π, −k, −sx, −sy]` are one
 * matrix, and `parts` always answers with `sx` of 0 or more. A spring that overshoots `scaleX` past
 * 0 has the second, so taking the first on a retarget would spin it half a turn; the rotation is
 * then taken the short way to the goal's.
 */
function nearer(p: Float64Array, dp: Float64Array, goal: Float64Array): void {
  const TURN = 2 * Math.PI;
  const g = goal[2] as number;
  const k = p[3] as number;
  const sx = p[4] as number;
  const sy = p[5] as number;
  const as = shortWay((p[2] as number) - g, TURN);
  const flipped = shortWay((p[2] as number) + Math.PI - g, TURN);
  const gk = goal[3] as number;
  const gx = goal[4] as number;
  const gy = goal[5] as number;
  const kept = Math.abs(as) + Math.abs(k - gk) + Math.abs(sx - gx) + Math.abs(sy - gy);
  const other = Math.abs(flipped) + Math.abs(k + gk) + Math.abs(sx + gx) + Math.abs(sy + gy);
  if (other < kept) {
    p[2] = g + flipped;
    for (let i = 3; i < 6; i++) {
      p[i] = -(p[i] as number);
      dp[i] = -(dp[i] as number);
    }
  } else p[2] = g + as;
}

const P0 = new Float64Array(6);
const D0 = new Float64Array(6);
const GOAL = new Float64Array(6);
const PS = new Float64Array(6);
const DS = new Float64Array(6);

/**
 * `closed` for a stretch of a 2D transform, solved on its parts as `affine`'s `lerp` goes between
 * two. A spring or tween starts from the form of its matrix nearer its target (`nearer`), so it
 * follows that lerp but where the start is mirrored against the target; a glide coasts each part
 * on, and a fling may turn it any number of times.
 */
export function closedParts(
  law: Float64Array,
  ease: Curve | undefined,
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
  parts(P0, x0, x);
  partsRate(D0, x0, x, v0, v, P0);
  const form = law[0];
  if (form === COAST) {
    const tau = law[2] as number;
    for (let i = 0; i < 6; i++) GOAL[i] = (P0[i] as number) + (D0[i] as number) * tau;
  } else if (form === DRIFT) GOAL.set(P0);
  else {
    parts(GOAL, to, g);
    nearer(P0, D0, GOAL);
  }
  const still = closed(law, ease, 6, at, ms, P0, 0, D0, 0, GOAL, 0, t, PS, DS);
  if (still && form !== COAST && form !== DRIFT) {
    for (let i = 0; i < 6; i++) {
      xo[i] = to[g + i] as number;
      vo[i] = 0;
    }
    return true;
  }
  compose(xo, PS);
  composeRate(vo, PS, DS);
  return still;
}
