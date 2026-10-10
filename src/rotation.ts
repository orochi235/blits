import { doubles, type Vec } from './channels.js';
import type { Channel } from './types.js';

/**
 * What `angle` takes.
 *
 * @category channel
 */
export interface AngleOptions {
  /** One full turn in the channel's unit. Default 360, for degrees; `2 * Math.PI` for radians. */
  turn?: number;
}

/**
 * A rotation about one axis, which adds as `sum` does and interpolates the short way round: from
 * 350 to 10 it passes 0, not 180. A weight below 1 fades it the short way to rest too. Its values
 * are angles, so two a whole number of turns apart are the same value, and a fold may answer with
 * either. It runs on the general path, never on a lane.
 *
 * @category channel
 */
export function angle(opts?: AngleOptions): Channel<number> {
  const turn = opts?.turn ?? 360;
  if (!(turn > 0)) throw new RangeError('blits: an angle takes a positive turn');
  const short = (d: number): number => d - turn * Math.round(d / turn);
  return {
    kind: `angle(${turn})`,
    rest: 0,
    merge: (a, b) => a + b,
    scale: (v, w) => short(v) * w,
    lerp: (a, b, u) => a + short(b - a) * u,
  };
}

type Q = Vec<4>;

/** `a` then `b`, written into `out`, which may be either. */
function multiply(out: number[], a: Q, b: Q): number[] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** The short arc from `a` to `b` at `u`, a unit quaternion, written into `out`. */
function slerp(out: number[], a: Q, b: Q, u: number): number[] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  // `q` and `-q` are one rotation; the nearer of the two is the short way.
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let p = 1 - u;
  let q = u;
  // Nearly parallel, the arc's sine is too small to divide by, and a straight line is as good.
  if (dot < 1 - 1e-9) {
    const theta = Math.acos(dot);
    const s = Math.sin(theta);
    p = Math.sin((1 - u) * theta) / s;
    q = Math.sin(u * theta) / s;
  }
  q *= sign;
  const x = p * a[0] + q * b[0];
  const y = p * a[1] + q * b[1];
  const z = p * a[2] + q * b[2];
  const w = p * a[3] + q * b[3];
  const n = Math.hypot(x, y, z, w) || 1;
  out[0] = x / n;
  out[1] = y / n;
  out[2] = z / n;
  out[3] = w / n;
  return out;
}

const IDENTITY: Q = [0, 0, 0, 1];
const scratch: number[] = doubles(4, 0);

/**
 * A rotation in space, as a unit quaternion `[x, y, z, w]`. Contributions compose by the Hamilton
 * product in the order their voices were cued, which matters: rotations do not commute. A weight
 * turns a contribution part of the way from no rotation, along the short arc, and `lerp` takes the
 * short arc between two. It runs on the general path, never on a lane.
 *
 * @category channel
 */
export function quat(): Channel<Vec<4>> {
  const rest = doubles(4, 0);
  rest[3] = 1;
  return {
    kind: 'quat',
    rest: rest as Q,
    merge: (a, b) => multiply(doubles(4, 0), a, b) as Q,
    scale: (v, w) => slerp(doubles(4, 0), IDENTITY, v, w) as Q,
    fold: (into, v, w) => multiply(into, into, slerp(scratch, IDENTITY, v, w) as Q) as Q,
    lerp: (a, b, u) => slerp(doubles(4, 0), a, b, u) as Q,
  };
}
