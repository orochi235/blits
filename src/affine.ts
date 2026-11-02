import { doubles, type Vec, vouch } from './channels.js';
import { shortWay } from './turns.js';
import type { Channel } from './types.js';

type M = Vec<6>;

/** `a` then `b`, as the matrix product `a·b`, written into `out`, which may be either. */
function multiply(out: number[], a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const [a0, a1, a2, a3, a4, a5] = a as M;
  const [b0, b1, b2, b3, b4, b5] = b as M;
  out[0] = a0 * b0 + a2 * b1;
  out[1] = a1 * b0 + a3 * b1;
  out[2] = a0 * b2 + a2 * b3;
  out[3] = a1 * b2 + a3 * b3;
  out[4] = a0 * b4 + a2 * b5 + a4;
  out[5] = a1 * b4 + a3 * b5 + a5;
  return out;
}

/**
 * A matrix's parts, `[x, y, rotate, shear, scaleX, scaleY]`: it is the translation, times the
 * rotation, times a horizontal shear by the factor `shear`, times the scale. A flip lands in
 * `scaleY`, and a matrix with no extent along x reads as unrotated.
 */
function parts(out: number[], m: ArrayLike<number>): number[] {
  const [a, b, c, d, e, f] = m as M;
  const sx = Math.hypot(a, b);
  const angle = sx === 0 ? 0 : Math.atan2(b, a);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sy = -sin * c + cos * d;
  out[0] = e;
  out[1] = f;
  out[2] = angle;
  out[3] = sy === 0 ? 0 : (cos * c + sin * d) / sy;
  out[4] = sx;
  out[5] = sy;
  return out;
}

/** The matrix with `parts` `[x, y, rotate, shear, scaleX, scaleY]`, written into `out`. */
function compose(out: number[], p: ArrayLike<number>): number[] {
  const [x, y, angle, k, sx, sy] = p as M;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out[0] = cos * sx;
  out[1] = sin * sx;
  out[2] = (cos * k - sin) * sy;
  out[3] = (sin * k + cos) * sy;
  out[4] = x;
  out[5] = y;
  return out;
}

const TURN = 2 * Math.PI;
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const pa = doubles(6, 0);
const pb = doubles(6, 0);
const step = doubles(6, 0);

/** `a` to `b` at `u` by their parts, the rotation the short way round, written into `out`. */
function between(out: number[], a: ArrayLike<number>, b: ArrayLike<number>, u: number): number[] {
  if (u === 0) return copy(out, a);
  if (u === 1) return copy(out, b);
  parts(pa, a);
  parts(pb, b);
  for (let i = 0; i < 6; i++) {
    const from = pa[i] as number;
    const by = (pb[i] as number) - from;
    pa[i] = from + (i === 2 ? shortWay(by, TURN) : by) * u;
  }
  return compose(out, pa);
}

function copy(out: number[], v: ArrayLike<number>): number[] {
  for (let i = 0; i < 6; i++) out[i] = v[i] as number;
  return out;
}

/**
 * A 2D transform, as the six numbers `[a, b, c, d, e, f]` of CSS's `matrix()` and canvas's
 * `setTransform`, in that order; `matrix` builds one from a translation, rotation, shear and scale.
 *
 * Contributions compose in the order their voices were cued, the first outermost, as a CSS
 * transform list reads left to right: a voice that rotates, cued before one that moves, swings the
 * moved subject round the origin. A weight takes a contribution part of the way from no transform,
 * and `lerp` goes between two transforms by their parts, the rotation the short way round, as CSS
 * interpolates matrices.
 *
 * @category channel
 */
export function affine(): Channel<Vec<6>> {
  const rest = doubles(6, 0);
  rest[0] = 1;
  rest[3] = 1;
  const channel: Channel<M> = {
    kind: 'affine',
    rest: rest as M,
    merge: (a, b) => multiply(doubles(6, 0), a, b) as M,
    scale: (v, w) => between(doubles(6, 0), IDENTITY, v, w) as M,
    fold: (into, v, w) => multiply(into, into, between(step, IDENTITY, v, w)) as M,
    lerp: (a, b, u) => between(doubles(6, 0), a, b, u) as M,
  };
  vouch(channel as Channel<unknown>, { op: 'own', axes: 6 });
  return channel;
}

/**
 * The parts of a 2D transform, any left out changing nothing. Angles are in radians.
 *
 * @category channel
 */
export interface MatrixParts {
  x?: number;
  y?: number;
  rotate?: number;
  /** A shear along x, as CSS `skewX`: the angle the vertical axis leans by. */
  skew?: number;
  /** Both axes at once, multiplied by `scaleX` and `scaleY` where given. */
  scale?: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * A transform for an `affine` channel, as `[a, b, c, d, e, f]`: the subject scaled, then sheared,
 * then rotated, then moved by `x` and `y`. `matrix({ x: 40, rotate: Math.PI / 4 })` turns a
 * subject an eighth of a turn where it stands and moves it 40 along.
 *
 * @category channel
 */
export function matrix(p: MatrixParts): Vec<6> {
  const s = p.scale ?? 1;
  const parts = [
    p.x ?? 0,
    p.y ?? 0,
    p.rotate ?? 0,
    Math.tan(p.skew ?? 0),
    s * (p.scaleX ?? 1),
    s * (p.scaleY ?? 1),
  ];
  return compose(doubles(6, 0), parts) as M;
}

/**
 * The parts of an `affine` transform, as `matrix` takes them: `matrix(partsOf(m))` gives `m` back.
 * A flip lands in `scaleY`, and a transform with no extent along x reads as unrotated.
 *
 * @category channel
 */
export function partsOf(m: ArrayLike<number>): Required<Omit<MatrixParts, 'scale'>> {
  const [x, y, rotate, shear, scaleX, scaleY] = parts(doubles(6, 0), m) as M;
  return { x, y, rotate, skew: Math.atan(shear), scaleX, scaleY };
}
