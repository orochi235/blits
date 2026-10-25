import type { Moving, Value } from './motion.js';

/**
 * A pointer's recent path, for the velocity it is let go at.
 *
 * @category fling
 */
export interface Track<V extends Value = number> {
  /** Where it was at `t`, ms; samples must come in time order. */
  add(t: number, x: V): void;
  /**
   * Units per second at `at`, default the latest sample: the least-squares slope of the samples
   * within `ms` of the latest, or zero once the latest is more than `stop` ms before `at`, or with
   * fewer than two samples.
   */
  velocity(at?: number): V;
  clear(): void;
}

/**
 * Tracks a pointer's velocity from its samples, with no listeners of its own: anything that can give
 * a time and a position can feed it.
 *
 * @category fling
 */
export function track<V extends Value = number>(
  opts: {
    /** How far back the slope reads, ms. Default 100. */
    ms?: number;
    /** How long a pointer can sit still before letting go and still fling, ms. Default 40. */
    stop?: number;
  } = {},
): Track<V> {
  const span = opts.ms ?? 100;
  const stop = opts.stop ?? 40;
  if (!(span > 0) || !(stop >= 0))
    throw new RangeError('blits: a track takes a positive ms and a stop of 0 or more');
  const ts: number[] = [];
  const xs: number[][] = [];
  let scalar = true;
  return {
    add(t, x) {
      scalar = typeof x === 'number';
      ts.push(t);
      xs.push(typeof x === 'number' ? [x] : [...(x as readonly number[])]);
      let drop = 0;
      while (t - (ts[drop] as number) > span) drop++;
      if (drop > 0) {
        ts.splice(0, drop);
        xs.splice(0, drop);
      }
    },
    velocity(at) {
      const n = ts.length;
      const axes = n === 0 ? 1 : (xs[0] as number[]).length;
      const out = new Array<number>(axes).fill(0);
      const last = ts[n - 1] as number;
      if (n >= 2 && !((at ?? last) - last > stop)) {
        let mt = 0;
        for (const t of ts) mt += t;
        mt /= n;
        let tt = 0;
        for (const t of ts) tt += (t - mt) ** 2;
        if (tt > 0)
          for (let k = 0; k < axes; k++) {
            let mx = 0;
            for (const x of xs) mx += x[k] as number;
            mx /= n;
            let tx = 0;
            for (let i = 0; i < n; i++)
              tx += ((ts[i] as number) - mt) * (((xs[i] as number[])[k] as number) - mx);
            out[k] = (tx / tt) * 1000;
          }
      }
      return (scalar ? out[0] : out) as V;
    },
    clear() {
      ts.length = 0;
      xs.length = 0;
    },
  };
}

/** The part of a pointer event `fling` reads. */
export interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

/** Anything pointer events come from: an element, or a stand-in for one. */
export interface PointerTarget {
  addEventListener(type: string, fn: (e: PointerLike) => void): void;
  removeEventListener(type: string, fn: (e: PointerLike) => void): void;
  setPointerCapture?(pointerId: number): void;
}

/** How much of a drag past an edge the subject follows, right at the edge. */
const PULL = 0.55;

/** How far a drag `d` past an edge carries the subject, never as far as `give`. */
const resist = (d: number, give: number): number =>
  give > 0 ? give * (1 - 1 / ((PULL * d) / give + 1)) : 0;

/** The drag past an edge that carries the subject `r` past it, as `resist` maps it. */
const unresist = (r: number, give: number): number => {
  const held = Math.min(r, give * 0.99);
  return give > 0 ? (give * held) / (PULL * (give - held)) : 0;
};

/**
 * Drags `subject` of a motion patch, usually a `glide`, by pointer on `target`, and flings it on
 * release at the pointer's velocity: a press stops it where it is, each move `set`s it under the
 * pointer, and letting go `push`es it. Past the edge of a glide's `bounds` it follows less and less
 * of the drag, never more than `give` past. One pointer at a time; a canceled one lets go at rest.
 * Returns the function that removes its listeners.
 *
 * @category fling
 */
export function fling<I, O, V extends Value = number>(
  target: PointerTarget,
  motion: Pick<Moving<I, O, V>, 'read' | 'set' | 'push'> & {
    bounds?(subject: I): readonly [min: V, max: V] | undefined;
  },
  subject: I,
  opts: {
    /** Which pointer axes it follows: `'xy'` moves a subject on two axes. Default `'y'`. */
    axis?: 'x' | 'y' | 'xy';
    /** Units per pixel of pointer travel; -1 scrolls content against the drag. Default 1. */
    scale?: number;
    /**
     * How far past an edge of the glide's bounds a drag can carry the subject, in its units; 0
     * holds it at the edge. Default 120.
     */
    give?: number;
    ms?: number;
    stop?: number;
  } = {},
): () => void {
  const axis = opts.axis ?? 'y';
  const scale = opts.scale ?? 1;
  const give = opts.give ?? 120;
  if (!(give >= 0)) throw new RangeError('blits: a fling takes a give of 0 or more');
  let lo: number[] | undefined;
  let hi: number[] | undefined;
  /** Where the drag `x` puts the subject, past an edge carried by `resist`. */
  const held = (x: number[]): number[] =>
    lo === undefined || hi === undefined
      ? x
      : x.map((xi, k) => {
          const a = (lo as number[])[k] as number;
          const b = (hi as number[])[k] as number;
          return xi < a ? a - resist(a - xi, give) : xi > b ? b + resist(xi - b, give) : xi;
        });
  /** The drag that puts the subject at `x`, as `held` maps it. */
  const dragged = (x: number[]): number[] =>
    lo === undefined || hi === undefined
      ? x
      : x.map((xi, k) => {
          const a = (lo as number[])[k] as number;
          const b = (hi as number[])[k] as number;
          return xi < a ? a - unresist(a - xi, give) : xi > b ? b + unresist(xi - b, give) : xi;
        });
  const path = track<number[]>(opts);
  let id: number | undefined;
  let from: number[] = [];
  let p0: number[] = [];
  const at = (e: PointerLike): number[] =>
    axis === 'x' ? [e.clientX] : axis === 'y' ? [e.clientY] : [e.clientX, e.clientY];
  const value = (x: number[]): V => (axis === 'xy' ? x : x[0]) as V;
  const flat = (v: V): number[] => (typeof v === 'number' ? [v] : [...(v as readonly number[])]);
  const zero = (): V => value(from.map(() => 0));
  const down = (e: PointerLike) => {
    if (id !== undefined) return;
    const now = motion.read(subject);
    if (now === undefined) return;
    id = e.pointerId;
    target.setPointerCapture?.(id);
    const edges = motion.bounds?.(subject);
    lo = edges === undefined ? undefined : flat(edges[0]);
    hi = edges === undefined ? undefined : flat(edges[1]);
    const here = flat(now.value);
    from = dragged(here);
    p0 = at(e);
    motion.push(subject, zero());
    // The push alone would spring a subject caught past an edge back; a set there holds it.
    motion.set(subject, value(here));
    path.clear();
    path.add(e.timeStamp, here);
  };
  const move = (e: PointerLike) => {
    if (e.pointerId !== id) return;
    const x = held(at(e).map((p, k) => (from[k] as number) + (p - (p0[k] as number)) * scale));
    motion.set(subject, value(x));
    path.add(e.timeStamp, x);
  };
  const up = (e: PointerLike) => {
    if (e.pointerId !== id) return;
    id = undefined;
    motion.push(subject, value(path.velocity(e.timeStamp)));
  };
  const cancel = (e: PointerLike) => {
    if (e.pointerId !== id) return;
    id = undefined;
    motion.push(subject, zero());
  };
  const on: [string, (e: PointerLike) => void][] = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', cancel],
  ];
  for (const [type, fn] of on) target.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of on) target.removeEventListener(type, fn);
  };
}
