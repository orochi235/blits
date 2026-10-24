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

/**
 * Drags `subject` of a motion patch, usually a `glide`, by pointer on `target`, and flings it on
 * release at the pointer's velocity: a press stops it where it is, each move `set`s it under the
 * pointer, and letting go `push`es it. One pointer at a time; a canceled one lets go at rest.
 * Returns the function that removes its listeners.
 *
 * @category fling
 */
export function fling<I, O, V extends Value = number>(
  target: PointerTarget,
  motion: Pick<Moving<I, O, V>, 'read' | 'set' | 'push'>,
  subject: I,
  opts: {
    /** Which pointer axes it follows: `'xy'` moves a subject on two axes. Default `'y'`. */
    axis?: 'x' | 'y' | 'xy';
    /** Units per pixel of pointer travel; -1 scrolls content against the drag. Default 1. */
    scale?: number;
    ms?: number;
    stop?: number;
  } = {},
): () => void {
  const axis = opts.axis ?? 'y';
  const scale = opts.scale ?? 1;
  const path = track<number[]>(opts);
  let id: number | undefined;
  let from: number[] = [];
  let p0: number[] = [];
  const at = (e: PointerLike): number[] =>
    axis === 'x' ? [e.clientX] : axis === 'y' ? [e.clientY] : [e.clientX, e.clientY];
  const value = (x: number[]): V => (axis === 'xy' ? x : x[0]) as V;
  const zero = (): V => value(from.map(() => 0));
  const down = (e: PointerLike) => {
    if (id !== undefined) return;
    const now = motion.read(subject);
    if (now === undefined) return;
    id = e.pointerId;
    target.setPointerCapture?.(id);
    from = typeof now.value === 'number' ? [now.value] : [...(now.value as readonly number[])];
    p0 = at(e);
    motion.push(subject, zero());
    path.clear();
    path.add(e.timeStamp, from);
  };
  const move = (e: PointerLike) => {
    if (e.pointerId !== id) return;
    const x = at(e).map((p, k) => (from[k] as number) + (p - (p0[k] as number)) * scale);
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
