import { COAST, closed } from './closed.js';
import type { Curve } from './easing.js';

/** Below this chroma a color is gray and its hue is noise, so it takes the other end's. */
export const GRAY = 1e-4;

/** Where `shortWay` leaves the hue a way starts from and how far it turns. */
export const HUES = [0, 0];

/** The way from hue `ah` to `bh` the short way round into `HUES`, a gray end taking the other's. */
export function shortWay(ah: number, ac: number, bh: number, bc: number): void {
  const from = ac < GRAY ? bh : ah;
  const to = bc < GRAY ? ah : bh;
  let turn = to - from;
  if (turn > Math.PI) turn -= 2 * Math.PI;
  else if (turn < -Math.PI) turn += 2 * Math.PI;
  HUES[0] = from;
  HUES[1] = turn;
}

/**
 * Two premultiplied OKLab colors, `[w·L, w·a, w·b, w]` read from `x` at `i` and `y` at `j`, into
 * `out` as `[L, C, h, w]` each, `y`'s hue the short way round from `x`'s. A color with no coverage
 * has none of its own to keep, so it takes the other end's.
 */
export function lchPair(
  x: ArrayLike<number>,
  i: number,
  y: ArrayLike<number>,
  j: number,
  out: Float64Array,
): void {
  const xw = x[i + 3] ?? 0;
  const yw = y[j + 3] ?? 0;
  const ys = yw > 0 ? 1 / yw : 0;
  const yL = (y[j] ?? 0) * ys;
  const yA = (y[j + 1] ?? 0) * ys;
  const yB = (y[j + 2] ?? 0) * ys;
  const xs = xw > 0 ? 1 / xw : 0;
  const xL = xw > 0 ? (x[i] ?? 0) * xs : yL;
  const xA = xw > 0 ? (x[i + 1] ?? 0) * xs : yA;
  const xB = xw > 0 ? (x[i + 2] ?? 0) * xs : yB;
  const toL = yw > 0 ? yL : xL;
  const toA = yw > 0 ? yA : xA;
  const toB = yw > 0 ? yB : xB;
  const xc = Math.sqrt(xA * xA + xB * xB);
  const yc = Math.sqrt(toA * toA + toB * toB);
  shortWay(Math.atan2(xB, xA), xc, Math.atan2(toB, toA), yc);
  out[0] = xL;
  out[1] = xc;
  out[2] = HUES[0] as number;
  out[3] = xw;
  out[4] = toL;
  out[5] = yc;
  out[6] = (HUES[0] as number) + (HUES[1] as number);
  out[7] = yw;
}

const PAIR = new Float64Array(8);
const RATES = new Float64Array(4);
const REST = new Float64Array(4);
const XS = new Float64Array(4);
const VS = new Float64Array(4);

/**
 * `closed` for a stretch of an `'oklch'` color: its ends and velocity, premultiplied OKLab as the
 * patch keeps them, moved into `[L, C, h, w]`, solved there axis by axis, and the position and
 * velocity moved back into `xo` and `vo`. A spring heads round the hue the short way from where
 * the stretch starts, so a retarget bends the path rather than restarting it, and one that
 * overshoots its target overshoots in hue too. A glide comes to rest `v·τ` along each of the four,
 * so it coasts round the hue rather than off along a tangent.
 */
export function closedLch(
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
  const p = PAIR;
  lchPair(x0, x, to, g, p);
  const L = p[0] as number;
  const C = p[1] as number;
  const h = p[2] as number;
  const w = p[3] as number;
  // OKLab's rates of change at the start, its coverage's share divided out, turned onto L, C and h.
  const dw = v0[v + 3] as number;
  let dL = 0;
  let dC = 0;
  let dh = 0;
  if (w > 0) {
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    dL = ((v0[v] as number) - dw * L) / w;
    const da = ((v0[v + 1] as number) - dw * C * cos) / w;
    const db = ((v0[v + 2] as number) - dw * C * sin) / w;
    dC = da * cos + db * sin;
    dh = C < GRAY ? 0 : (db * cos - da * sin) / C;
  }
  RATES[0] = dL;
  RATES[1] = dC;
  RATES[2] = dh;
  RATES[3] = dw;
  let goal: Float64Array = p;
  let o = 4;
  if (law[0] === COAST) {
    const tau = law[2] as number;
    for (let i = 0; i < 4; i++) REST[i] = (p[i] as number) + (RATES[i] as number) * tau;
    goal = REST;
    o = 0;
  }
  const still = closed(law, ease, 4, at, ms, p, 0, RATES, 0, goal, o, t, XS, VS);
  if (still && o === 4) {
    for (let i = 0; i < 4; i++) {
      xo[i] = to[g + i] as number;
      vo[i] = 0;
    }
    return true;
  }
  const nL = XS[0] as number;
  const nC = XS[1] as number;
  const nh = XS[2] as number;
  const nw = XS[3] as number;
  const cos = Math.cos(nh);
  const sin = Math.sin(nh);
  const a = nC * cos;
  const b = nC * sin;
  const rL = VS[0] as number;
  const rC = VS[1] as number;
  const rh = VS[2] as number;
  const rw = VS[3] as number;
  xo[0] = nL * nw;
  xo[1] = a * nw;
  xo[2] = b * nw;
  xo[3] = nw;
  vo[0] = rL * nw + nL * rw;
  vo[1] = (rC * cos - nC * rh * sin) * nw + a * rw;
  vo[2] = (rC * sin + nC * rh * cos) * nw + b * rw;
  vo[3] = rw;
  return still;
}
