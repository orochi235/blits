import { clampWeight } from './clock.js';
import type { Easing, LinearPoint } from './types.js';

/**
 * The function an easing stands for, a curve on 0..1.
 *
 * @category patch
 */
export type Curve = (u: number) => number;

const linear: Curve = (u) => u;

/** Width of a curve's numbers: a kind, then what the kind needs, padded with 0. */
export const CURVE_WIDTH = 5;

const packed = new WeakMap<Curve, number[]>();

function pack(c: Curve, ...nums: number[]): Curve {
  packed.set(c, [...nums, 0, 0, 0, 0, 0].slice(0, CURVE_WIDTH));
  return c;
}

/**
 * A curve as numbers for the GPU: `[0]` for none or linear, `[1, x1, y1, x2, y2]` for a bezier,
 * `[2, n, add, more]` for steps (`add` 1 where the first step is taken at 0, and `n + more` the
 * jumps it makes), each padded to `CURVE_WIDTH`. A `linear` easing is `[3, from, count]` padded so,
 * then its `count` points as input, output pairs, `from` numbers after the 3: a packer that moves
 * the points elsewhere sets `from` to where they went. Undefined for a plain function.
 */
export function curveData(c: Curve | undefined): readonly number[] | undefined {
  return c === undefined ? packed.get(linear) : packed.get(c);
}

/** Whether a segment eased by `c` runs in a straight line: no easing, or `linear`. */
export function straight(c: Curve | undefined): boolean {
  return c === undefined || c === linear;
}

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
  return pack(
    (u) => {
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
    },
    1,
    x1,
    y1,
    x2,
    y2,
  );
}

pack(linear, 0);

const named: Record<Exclude<Easing, object | ((u: number) => number)>, Curve> = {
  linear,
  ease: bezier(0.25, 0.1, 0.25, 1),
  'ease-in': bezier(0.42, 0, 1, 1),
  'ease-out': bezier(0, 0, 0.58, 1),
  'ease-in-out': bezier(0.42, 0, 0.58, 1),
};

const built = new WeakMap<object, Curve>();

/** Each `steps` curve's count of steps. */
const stepped = new WeakMap<Curve, number>();

/** How many steps a curve takes, for one built from `steps`; undefined for any other. */
export function stepsOf(c: Curve): number | undefined {
  return stepped.get(c);
}

/** Each built curve's slope at 0, where its definition gives one: an infinity for a jump. */
const starts = new WeakMap<Curve, number>([[linear, 1]]);

/** A bezier's slope at u = 0: dy/dx as t leaves 0, by the first control point that moves x. */
function bezierStart(x1: number, y1: number, x2: number, y2: number): number {
  if (x1 > 0) return y1 / x1;
  if (y1 !== 0) return y1 > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  if (x2 > 0) return y2 / x2;
  if (y2 !== 0) return y2 > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return 1;
}

/**
 * How fast a curve leaves 0, for bending a retarget to the speed the subject had: an infinity, of
 * the jump's sign, where the curve jumps or leaves vertically, so no finite bend can match it.
 */
export function startSlope(c: Curve): number {
  const known = starts.get(c);
  if (known !== undefined) return known;
  const h = 1e-6;
  const v = c(h);
  // Past a thousandth of the way within a millionth of the time: a jump, not a slope.
  if (v > 1e-3) return Number.POSITIVE_INFINITY;
  return v < -1e-3 ? Number.NEGATIVE_INFINITY : v / h;
}

/** CSS `steps()`: the step `u` is on, counting the one `jump-start` and `jump-both` take at 0, of
 *  the jumps the form makes. */
function stepsCurve(n: number, jump: 'start' | 'end' | 'none' | 'both'): Curve {
  const least = jump === 'none' ? 2 : 1;
  if (!(Number.isInteger(n) && n >= least))
    throw new RangeError(
      `blits: steps with jump ${jump} takes a whole number of ${least} or more, not ${n}`,
    );
  const add = jump === 'start' || jump === 'both' ? 1 : 0;
  const more = jump === 'both' ? 1 : jump === 'none' ? -1 : 0;
  const jumps = n + more;
  const made = pack(
    (u) => Math.min(jumps, Math.floor(clampWeight(u) * n) + add) / jumps,
    2,
    n,
    add,
    more,
  );
  starts.set(made, add ? Number.POSITIVE_INFINITY : 0);
  stepped.set(made, n);
  return made;
}

/**
 * CSS's `linear()` points as inputs and outputs: a point held over two inputs is two points, the
 * first and last take 0 and 1 where they have no input, an input behind one before it moves up to
 * it, and a run with none is spread evenly between the inputs either side.
 */
function linearPoints(list: readonly LinearPoint[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of list) {
    const [y, ...at] = typeof p === 'number' ? [p] : p;
    if (at.length > 2 || ![y, ...at].every(Number.isFinite))
      throw new RangeError(
        `blits: a linear point is an output and up to two inputs, all finite, not ${JSON.stringify(p)}`,
      );
    for (const x of at.length ? at : [Number.NaN]) {
      xs.push(x);
      ys.push(y as number);
    }
  }
  if (xs.length < 2) throw new RangeError('blits: linear takes two points or more');
  if (Number.isNaN(xs[0])) xs[0] = 0;
  if (Number.isNaN(xs[xs.length - 1])) xs[xs.length - 1] = 1;
  let most = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    if (Number.isNaN(x)) continue;
    most = Math.max(most, x);
    xs[i] = most;
  }
  for (let i = 1; i < xs.length; i++) {
    if (!Number.isNaN(xs[i])) continue;
    let j = i;
    while (Number.isNaN(xs[j])) j++;
    const a = xs[i - 1] as number;
    const step = ((xs[j] as number) - a) / (j - i + 1);
    for (let k = i; k < j; k++) xs[k] = a + step * (k - i + 1);
    i = j;
  }
  return { xs, ys };
}

/** CSS `linear()`: straight lines between the points, carried on past the first and last two. */
function linearCurve(list: readonly LinearPoint[]): Curve {
  const { xs, ys } = linearPoints(list);
  const n = xs.length;
  const made: Curve = (u) => {
    let hit = -1;
    let below = -1;
    for (let i = 0; i < n; i++) {
      const x = xs[i] as number;
      if (x === u) hit = i;
      if (x < u) below = i;
    }
    if (hit >= 0) return ys[hit] as number;
    const a = Math.min(Math.max(below, 0), n - 2);
    const ax = xs[a] as number;
    const bx = xs[a + 1] as number;
    if (ax === bx) return ys[a + 1] as number;
    const ay = ys[a] as number;
    return ay + ((ys[a + 1] as number) - ay) * ((u - ax) / (bx - ax));
  };
  const points: number[] = [];
  for (let i = 0; i < n; i++) points.push(xs[i] as number, ys[i] as number);
  packed.set(made, [3, CURVE_WIDTH, n, 0, 0, ...points]);
  return made;
}

/**
 * The function an easing names. The easing is a CSS name, a `bezier`, `steps` or `linear`, or a function,
 * which comes back as it is. Call it once where a curve is built, not per frame; the same name or
 * easing object gives the same function each time.
 *
 * @category patch
 */
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
    const [x1, y1, x2, y2] = easing.bezier;
    // CSS refuses an x outside 0..1, where x(t) turns back and u has more than one t.
    if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1 && Number.isFinite(y1) && Number.isFinite(y2)))
      throw new RangeError(
        `blits: a bezier takes x1 and x2 from 0 to 1 and finite y1 and y2, not [${easing.bezier.join(', ')}]`,
      );
    made = bezier(...easing.bezier);
    starts.set(made, bezierStart(...easing.bezier));
  } else if ('linear' in easing) {
    made = linearCurve(easing.linear);
  } else {
    made = stepsCurve(easing.steps, easing.jump ?? 'end');
  }
  built.set(easing, made);
  return made;
}
