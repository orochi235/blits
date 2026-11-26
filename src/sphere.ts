import { COAST, closed, DRIFT } from './closed.js';
import type { Curve } from './easing.js';

const BASE = new Float64Array(4);
const R = new Float64Array(4);
const DR = new Float64Array(4);
const Y0 = new Float64Array(3);
const W0 = new Float64Array(3);
const GOAL = new Float64Array(3);
const YS = new Float64Array(3);
const WS = new Float64Array(3);
const Q = new Float64Array(4);
const DQ = new Float64Array(4);

/** `conj(a) ⊗ b`, `a` from `aa[ai]` and `b` from `bb[bi]`, into `out`. */
function under(
  out: Float64Array,
  aa: ArrayLike<number>,
  ai: number,
  bb: ArrayLike<number>,
  bi: number,
): void {
  const ax = -(aa[ai] as number);
  const ay = -(aa[ai + 1] as number);
  const az = -(aa[ai + 2] as number);
  const aw = aa[ai + 3] as number;
  const bx = bb[bi] as number;
  const by = bb[bi + 1] as number;
  const bz = bb[bi + 2] as number;
  const bw = bb[bi + 3] as number;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** `a ⊗ b` into `out`, which is neither. */
function times(out: Float64Array, a: Float64Array, b: Float64Array): void {
  const ax = a[0] as number;
  const ay = a[1] as number;
  const az = a[2] as number;
  const aw = a[3] as number;
  const bx = b[0] as number;
  const by = b[1] as number;
  const bz = b[2] as number;
  const bw = b[3] as number;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/**
 * For a rotation vector of length `θ`, `sin(θ/2)/θ` into `[0]` and its derivative over `θ` divided
 * by `θ` into `[1]`, each by its series near 0, where the closed forms divide by nearly nothing.
 */
const F = [0, 0];
function halves(theta: number, sin: number, cos: number): void {
  if (theta < 1e-3) {
    const t2 = theta * theta;
    F[0] = 0.5 - t2 / 48;
    F[1] = -1 / 24 + t2 / 960;
    return;
  }
  F[0] = sin / theta;
  F[1] = ((theta * cos) / 2 - sin) / (theta * theta * theta);
}

/**
 * `R`, a unit quaternion with `w` of 0 or more, and `DR`, its rate, as a rotation vector and its
 * rate, into `Y0` and `W0`: the exact inverse of `unfold`, so a stretch starts where and as fast
 * as the last one left off.
 */
function fold(): void {
  const vx = R[0] as number;
  const vy = R[1] as number;
  const vz = R[2] as number;
  const w = R[3] as number;
  const s = Math.hypot(vx, vy, vz);
  const theta = 2 * Math.atan2(s, w);
  halves(theta, s, w);
  const f = F[0] as number;
  const g = F[1] as number;
  const yx = vx / f;
  const yy = vy / f;
  const yz = vz / f;
  Y0[0] = yx;
  Y0[1] = yy;
  Y0[2] = yz;
  // `unfold`'s rates read backward: w's gives y·ẏ, and the rest follows from the vector's.
  const yd = (-2 * (DR[3] as number)) / f;
  W0[0] = ((DR[0] as number) - g * yx * yd) / f;
  W0[1] = ((DR[1] as number) - g * yy * yd) / f;
  W0[2] = ((DR[2] as number) - g * yz * yd) / f;
}

/** The rotation vector `YS` moving at `WS` as a unit quaternion and its rate, into `Q` and `DQ`. */
function unfold(): void {
  const yx = YS[0] as number;
  const yy = YS[1] as number;
  const yz = YS[2] as number;
  const theta = Math.hypot(yx, yy, yz);
  const sin = Math.sin(theta / 2);
  const cos = Math.cos(theta / 2);
  halves(theta, sin, cos);
  const f = F[0] as number;
  const g = F[1] as number;
  Q[0] = f * yx;
  Q[1] = f * yy;
  Q[2] = f * yz;
  Q[3] = cos;
  const wx = WS[0] as number;
  const wy = WS[1] as number;
  const wz = WS[2] as number;
  const yd = yx * wx + yy * wy + yz * wz;
  DQ[0] = f * wx + g * yx * yd;
  DQ[1] = f * wy + g * yy * yd;
  DQ[2] = f * wz + g * yz * yd;
  DQ[3] = (-f / 2) * yd;
}

/**
 * `closed` for a stretch of a rotation, its ends and velocity unit quaternions and a quaternion's
 * rate as the patch keeps them. Solved on the rotation vector from a base, where each closed form
 * is one, and turned back onto the sphere: a spring or tween's base is its target, on the side of
 * the sphere the stretch starts on, so it heads the short way and lands on that side; a glide or a
 * drift has no target, and its base is where it starts, so a fling turns as far as it carries.
 */
export function closedSphere(
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
  // Its start on the sphere, and its velocity along it.
  let qx = x0[x] as number;
  let qy = x0[x + 1] as number;
  let qz = x0[x + 2] as number;
  let qw = x0[x + 3] as number;
  const qn = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= qn;
  qy /= qn;
  qz /= qn;
  qw /= qn;
  let dx = v0[v] as number;
  let dy = v0[v + 1] as number;
  let dz = v0[v + 2] as number;
  let dw = v0[v + 3] as number;
  const along = qx * dx + qy * dy + qz * dz + qw * dw;
  dx -= along * qx;
  dy -= along * qy;
  dz -= along * qz;
  dw -= along * qw;
  const form = law[0];
  const free = form === COAST || form === DRIFT;
  if (free) {
    BASE[0] = qx;
    BASE[1] = qy;
    BASE[2] = qz;
    BASE[3] = qw;
  } else {
    let gx = to[g] as number;
    let gy = to[g + 1] as number;
    let gz = to[g + 2] as number;
    let gw = to[g + 3] as number;
    const gn = Math.hypot(gx, gy, gz, gw) || 1;
    const side = gx * qx + gy * qy + gz * qz + gw * qw < 0 ? -gn : gn;
    gx /= side;
    gy /= side;
    gz /= side;
    gw /= side;
    BASE[0] = gx;
    BASE[1] = gy;
    BASE[2] = gz;
    BASE[3] = gw;
  }
  Q[0] = qx;
  Q[1] = qy;
  Q[2] = qz;
  Q[3] = qw;
  DQ[0] = dx;
  DQ[1] = dy;
  DQ[2] = dz;
  DQ[3] = dw;
  under(R, BASE, 0, Q, 0);
  under(DR, BASE, 0, DQ, 0);
  fold();
  if (form === COAST) {
    const tau = law[2] as number;
    for (let i = 0; i < 3; i++) GOAL[i] = (Y0[i] as number) + (W0[i] as number) * tau;
  } else if (form === DRIFT) GOAL.set(Y0);
  else GOAL.fill(0);
  const still = closed(law, ease, 3, at, ms, Y0, 0, W0, 0, GOAL, 0, t, YS, WS);
  unfold();
  times(R, BASE, Q);
  times(DR, BASE, DQ);
  for (let i = 0; i < 4; i++) {
    xo[i] = R[i] as number;
    vo[i] = DR[i] as number;
  }
  return still;
}
