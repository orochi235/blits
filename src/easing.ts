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
  if ('bezier' in easing) made = bezier(...easing.bezier);
  else {
    const n = easing.steps;
    const start = easing.jump === 'start';
    made = (u) => {
      const c = u <= 0 ? 0 : u >= 1 ? 1 : u;
      return (start ? Math.ceil(c * n) : Math.floor(c * n)) / n;
    };
  }
  built.set(easing, made);
  return made;
}
