import type { Easing } from './types.js';

export type Curve = (u: number) => number;

const linear: Curve = (u) => u;

/** A CSS `cubic-bezier`: solves x(t) = u for t, then reads y(t). */
function bezier(x1: number, y1: number, x2: number, y2: number): Curve {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) {
      const err = x(t) - u;
      if (Math.abs(err) < 1e-7) return y(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = u;
    while (hi - lo > 1e-7) {
      if (x(t) < u) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return y(t);
  };
}

const named: Record<Exclude<Easing, object | ((u: number) => number)>, Curve> = {
  linear,
  ease: bezier(0.25, 0.1, 0.25, 1),
  'ease-in': bezier(0.42, 0, 1, 1),
  'ease-out': bezier(0, 0, 0.58, 1),
  'ease-in-out': bezier(0.42, 0, 0.58, 1),
};

const built = new WeakMap<object, Curve>();

/** Each built curve's slope at 0, where its definition gives one: Infinity for a jump. */
const starts = new WeakMap<Curve, number>([[linear, 1]]);

/** A bezier's slope at u = 0: dy/dx as t leaves 0, by the first control point that moves x. */
function bezierStart(x1: number, y1: number, x2: number, y2: number): number {
  if (x1 > 0) return y1 / x1;
  if (y1 > 0) return Number.POSITIVE_INFINITY;
  if (x2 > 0) return y2 / x2;
  return y2 > 0 ? Number.POSITIVE_INFINITY : 1;
}

/**
 * How fast a curve leaves 0, for bending a retarget to the speed the subject had: Infinity where
 * the curve jumps or leaves vertically, so no finite bend can match it.
 */
export function startSlope(c: Curve): number {
  const known = starts.get(c);
  if (known !== undefined) return known;
  const h = 1e-6;
  const v = c(h);
  // Past a thousandth of the way within a millionth of the time: a jump, not a slope.
  return v > 1e-3 ? Number.POSITIVE_INFINITY : v / h;
}

/** The function an easing names. Resolved once where a patch or voice is built, not per frame. */
export function curve(easing: Easing): Curve {
  if (typeof easing === 'function') return easing;
  if (typeof easing === 'string') {
    const found = named[easing];
    if (!found) throw new Error(`blits: no easing named ${easing}`);
    return found;
  }
  const held = built.get(easing);
  if (held) return held;
  let made: Curve;
  if ('bezier' in easing) {
    made = bezier(...easing.bezier);
    starts.set(made, bezierStart(...easing.bezier));
  } else {
    const n = easing.steps;
    const start = easing.jump === 'start';
    made = (u) => {
      const c = u <= 0 ? 0 : u >= 1 ? 1 : u;
      return (start ? Math.ceil(c * n) : Math.floor(c * n)) / n;
    };
    starts.set(made, start ? Number.POSITIVE_INFINITY : 0);
  }
  built.set(easing, made);
  return made;
}
