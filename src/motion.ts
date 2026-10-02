import { absent, Numbers } from './numbers.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import type { MotionSpec, Patch, Setting } from './types.js';

/**
 * A number, or one number per axis.
 *
 * @category patch
 */
export type Value = number | readonly number[];
/**
 * One value for every subject, or one per subject.
 *
 * @category patch
 */
export type PerSubject<I, V> = V | ((subject: I) => V);

/**
 * Where a subject is and how fast it is moving, at one moment of voice time.
 *
 * @category patch
 */
export interface Motion<V extends Value = number> {
  value: V;
  /** Units per second. */
  velocity: V;
}

/** One closed-form stretch: released at `at` (voice ms) from `x0` moving at `v0`, toward `to`. */
interface Segment {
  at: number;
  x0: number[];
  v0: number[];
  to: number[];
}

interface Change {
  /** Voice ms it takes effect at; absent, at the subject's next read. */
  at?: number;
  to?: number[];
  v?: number[];
}

/** One axis, `t` seconds after release, `y0` from where it heads and moving at `v0`, into `solved`. */
type Solve = (y0: number, v0: number, t: number) => void;
const solved = { y: 0, dy: 0 };

const axes = (v: Value): number[] => (typeof v === 'number' ? [v] : [...v]);
const per = <I, V>(p: PerSubject<I, V>, subject: I): V =>
  typeof p === 'function' ? (p as (s: I) => V)(subject) : p;

/**
 * A patch whose motion is a closed form per subject, so it lands in the same place at any frame
 * rate, and whose changes mid-flight start from where the subject is and how fast it moves.
 *
 * @category patch
 */
export type Moving<I, O, V extends Value> = Patch<I, O, void> & {
  /** Where `subject` is and how fast it moves at voice time `at`, default its last read. */
  read(subject: I, at?: number): Motion<V> | undefined;
  /** Sets `subject` moving at `velocity`, units per second, from voice time `at`, default its next read. */
  push(subject: I, velocity: V, at?: number): void;
};

interface Shape<I> {
  from: (subject: I) => number[];
  velocity: (subject: I) => number[];
  /** Where it heads when released from `x` at `v`, given where it was heading. */
  aim: (x: number[], v: number[], was: number[] | null, subject: I) => number[];
  solve: Solve;
  settle: number;
  /** Whether a subject's value is a number rather than an array. */
  scalar: (subject: I) => boolean;
}

/**
 * A motion patch's subjects: the stretch each is playing, in flat arrays by a number the patch
 * gives it, with earlier stretches a read back may reach and changes not yet applied beside them.
 * The one copy, read by `at` and by a mix's lane alike.
 */
export class Motions<I> {
  private readonly numbers = new Numbers<I>((slot) => this.forget(slot));
  private readonly slots = new Store<I, number>();
  /** Axes per subject; -1 until the first subject sets it. */
  n = -1;
  private cap = 0;
  at = new Float64Array(0);
  x0 = new Float64Array(0);
  v0 = new Float64Array(0);
  to = new Float64Array(0);
  /** The voice time of each subject's last live read, for `read` with no time given. */
  last = new Float64Array(0);
  scalar = new Uint8Array(0);
  /** Where `sample` leaves a subject's position and velocity, per axis. */
  xs = new Float64Array(0);
  vs = new Float64Array(0);
  private readonly pending = new Map<number, Change[]>();
  private readonly older = new Map<number, Segment[]>();

  constructor(private readonly shape: Shape<I>) {}

  /** The patch's number for `subject`, made with its first stretch on first ask. */
  slot(subject: I): number {
    const known = this.slots.get(subject);
    if (known !== undefined) return known;
    const x = this.shape.from(subject);
    const v = this.shape.velocity(subject);
    if (this.n < 0) {
      this.n = x.length;
      this.xs = new Float64Array(this.n);
      this.vs = new Float64Array(this.n);
    } else if (x.length !== this.n)
      throw new Error('blits: a motion patch moves every subject on the same number of axes');
    const s = this.numbers.take(subject);
    this.slots.set(subject, s);
    this.grow(s + 1);
    this.scalar[s] = this.shape.scalar(subject) ? 1 : 0;
    this.last[s] = Number.NaN;
    this.write(s, { at: 0, x0: x, v0: v, to: this.shape.aim(x, v, null, subject) });
    return s;
  }

  /** The value `at` hands the mix: the first axis for a number, a fresh array otherwise. */
  value(s: number, xs: Float64Array): number | number[] {
    return this.scalar[s] === 1 ? (xs[0] as number) : Array.from(xs.subarray(0, this.n));
  }

  /**
   * Position and velocity at voice time `t` into `xo` and `vo`. A live read commits every change due
   * by then, in order, an untimed one at `t`; a projection's read applies them to a copy, an untimed
   * one at the last live read, and commits nothing.
   */
  sample(s: number, t: number, xo: Float64Array, vo: Float64Array): void {
    if (reading.live) {
      if (this.pending.size > 0 && this.pending.has(s)) this.commit(s, t);
      if (this.older.size > 0) this.prune(s);
      this.last[s] = t;
      if (t < (this.at[s] as number) && this.older.has(s)) {
        const seg = this.playing(s, t);
        this.evaluate(seg.at, seg.x0, seg.v0, seg.to, 0, t, xo, vo);
      } else this.evaluate(this.at[s] as number, this.x0, this.v0, this.to, s * this.n, t, xo, vo);
      return;
    }
    let seg = this.playing(s, t);
    const list = this.pending.get(s);
    if (list !== undefined)
      for (const change of list) {
        const a = change.at ?? (this.last[s] as number);
        if (!(a <= t)) break;
        if (a >= seg.at) seg = this.applied(s, seg, change, a);
      }
    this.evaluate(seg.at, seg.x0, seg.v0, seg.to, 0, t, xo, vo);
  }

  read(subject: I, at?: number): { x: Float64Array; v: Float64Array; s: number } | undefined {
    const s = this.slots.get(subject);
    if (s === undefined) return undefined;
    const when = at ?? (this.last[s] as number);
    if (Number.isNaN(when)) return undefined;
    const seg = this.playing(s, when);
    const x = new Float64Array(this.n);
    const v = new Float64Array(this.n);
    this.evaluate(seg.at, seg.x0, seg.v0, seg.to, 0, when, x, v);
    return { x, v, s };
  }

  change(subject: I, c: Change): void {
    const s = this.slot(subject);
    const list = this.pending.get(s);
    if (list === undefined) this.pending.set(s, [c]);
    else list.push(c);
  }

  private forget(s: number): void {
    this.pending.delete(s);
    this.older.delete(s);
  }

  private grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2, 16);
    const n = this.n;
    const more = (a: Float64Array, width: number) => {
      const b = new Float64Array(cap * width);
      b.set(a);
      return b;
    };
    this.at = more(this.at, 1);
    this.last = more(this.last, 1);
    this.x0 = more(this.x0, n);
    this.v0 = more(this.v0, n);
    this.to = more(this.to, n);
    const sc = new Uint8Array(cap);
    sc.set(this.scalar);
    this.scalar = sc;
    this.cap = cap;
  }

  private write(s: number, seg: Segment): void {
    const n = this.n;
    this.at[s] = seg.at;
    for (let i = 0; i < n; i++) {
      this.x0[s * n + i] = seg.x0[i] as number;
      this.v0[s * n + i] = seg.v0[i] as number;
      this.to[s * n + i] = seg.to[i] as number;
    }
  }

  /** The stretch subject `s` is playing now, as an object. */
  private latest(s: number): Segment {
    const n = this.n;
    const o = s * n;
    return {
      at: this.at[s] as number,
      x0: Array.from(this.x0.subarray(o, o + n)),
      v0: Array.from(this.v0.subarray(o, o + n)),
      to: Array.from(this.to.subarray(o, o + n)),
    };
  }

  /** The stretch playing at voice time `t`: the latest released by then, else the first. */
  private playing(s: number, t: number): Segment {
    const list = this.older.get(s);
    if (list === undefined || t >= (this.at[s] as number)) return this.latest(s);
    if ((list[0] as Segment).at > t) return list[0] as Segment;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((list[mid] as Segment).at <= t) lo = mid;
      else hi = mid - 1;
    }
    return list[lo] as Segment;
  }

  private applied(s: number, seg: Segment, change: Change, at: number): Segment {
    const x = new Float64Array(this.n);
    const v = new Float64Array(this.n);
    this.evaluate(seg.at, seg.x0, seg.v0, seg.to, 0, at, x, v);
    const xs = Array.from(x);
    const vs = change.v ?? Array.from(v);
    const subject = this.numbers.subject(s);
    const to = this.shape.aim(
      xs,
      vs,
      change.to ?? seg.to,
      subject === absent ? (undefined as I) : subject,
    );
    return { at, x0: xs, v0: vs, to };
  }

  private commit(s: number, t: number): void {
    const list = this.pending.get(s) as Change[];
    while (list.length > 0) {
      const change = list[0] as Change;
      const a = change.at ?? t;
      if (a > t) break;
      list.shift();
      this.insert(s, this.applied(s, this.playing(s, a), change, a));
    }
    if (list.length === 0) this.pending.delete(s);
  }

  private insert(s: number, seg: Segment): void {
    let list = this.older.get(s);
    if (seg.at >= (this.at[s] as number)) {
      if (list === undefined) {
        list = [];
        this.older.set(s, list);
      }
      list.push(this.latest(s));
      this.write(s, seg);
      return;
    }
    if (list === undefined) {
      list = [];
      this.older.set(s, list);
    }
    let i = list.length;
    while (i > 0 && (list[i - 1] as Segment).at > seg.at) i--;
    list.splice(i, 0, seg);
  }

  /** Lets go of stretches older than the one in force at `reading.horizon`. */
  private prune(s: number): void {
    const list = this.older.get(s);
    if (list === undefined) return;
    while (
      list.length > 0 &&
      (list.length > 1 ? (list[1] as Segment).at : (this.at[s] as number)) <= reading.horizon
    )
      list.shift();
    if (list.length === 0) this.older.delete(s);
  }

  private evaluate(
    at: number,
    x0: ArrayLike<number>,
    v0: ArrayLike<number>,
    to: ArrayLike<number>,
    off: number,
    t: number,
    xo: Float64Array,
    vo: Float64Array,
  ): void {
    const n = this.n;
    const dt = Math.max(0, t - at) / 1000;
    const settle = this.shape.settle;
    let still = settle > 0;
    for (let i = 0; i < n; i++) {
      const goal = to[off + i] as number;
      this.shape.solve((x0[off + i] as number) - goal, v0[off + i] as number, dt);
      xo[i] = goal + solved.y;
      vo[i] = solved.dy;
      if (Math.abs(solved.y) > settle || Math.abs(solved.dy) > settle) still = false;
    }
    if (still)
      for (let i = 0; i < n; i++) {
        xo[i] = to[off + i] as number;
        vo[i] = 0;
      }
  }
}

const states = new WeakMap<object, Motions<unknown>>();

/** The state behind a `'motion'` patch, for an engine that reads it directly. */
export function motionOf<I>(p: object): Motions<I> | undefined {
  return states.get(p) as Motions<I> | undefined;
}

function moving<I, O, V extends Value>(writes: keyof O, motion: MotionSpec, shape: Shape<I>) {
  const state = new Motions<I>(shape);
  const patch = {
    form: 'motion' as const,
    period: 0,
    writes: [writes] as (keyof O)[],
    motion,
    at(_phase: number, subject: I, setting: Setting<void>): Partial<O> {
      const s = state.slot(subject);
      state.sample(s, setting.elapsed, state.xs, state.vs);
      return { [writes]: state.value(s, state.xs) } as Partial<O>;
    },
    read(subject: I, at?: number): Motion<V> | undefined {
      const r = state.read(subject, at);
      if (r === undefined) return undefined;
      return { value: state.value(r.s, r.x) as V, velocity: state.value(r.s, r.v) as V };
    },
    push(subject: I, velocity: V, at?: number): void {
      state.change(subject, { at, v: axes(velocity) });
    },
  };
  states.set(patch, state as Motions<unknown>);
  return { patch, state };
}

interface Common<I, V extends Value> {
  /** Units per second each subject starts moving at. Default 0. */
  velocity?: PerSubject<I, V>;
  /**
   * Within this distance of where it heads, and this slow, a subject lands there exactly, so a mix
   * can see it at rest. Default 1e-4; 0 keeps the curve exact.
   */
  settle?: number;
}

/**
 * A damped spring toward a target, solved in closed form. `to(subject, target)` retargets one
 * subject mid-flight, and the new stretch starts from where it is and how fast it moves, so there is
 * no kink. Time is the voice's, so `rate` and `seek` apply. Its state is its own, kept per subject:
 * cue each spring on one voice. Every subject moves on the same number of axes.
 *
 * @category patch
 */
export function spring<I, O, V extends Value = number>(
  writes: keyof O,
  opts: Common<I, V> & {
    to: PerSubject<I, V>;
    /** Where each subject starts. Default: `to`, at rest. */
    from?: PerSubject<I, V>;
    /** Per second squared. Default 170. */
    stiffness?: number;
    /** Per second. Default 26, just short of critical at the default stiffness. */
    damping?: number;
    mass?: number;
  },
): Moving<I, O, V> & {
  /** Heads `subject` for `target` from voice time `at`, default its next read, keeping its velocity. */
  to(subject: I, target: V, at?: number): void;
} {
  const k = opts.stiffness ?? 170;
  const c = opts.damping ?? 26;
  const m = opts.mass ?? 1;
  const settle = opts.settle ?? 1e-4;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  let solve: Solve;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    solve = (y0, v0, t) => {
      const e = Math.exp(-zeta * w0 * t);
      const b = (v0 + zeta * w0 * y0) / wd;
      const cos = Math.cos(wd * t);
      const sin = Math.sin(wd * t);
      const y = e * (y0 * cos + b * sin);
      solved.y = y;
      solved.dy = -zeta * w0 * y + e * wd * (b * cos - y0 * sin);
    };
  } else if (zeta === 1) {
    solve = (y0, v0, t) => {
      const e = Math.exp(-w0 * t);
      const b = v0 + w0 * y0;
      const y = e * (y0 + b * t);
      solved.y = y;
      solved.dy = e * b - w0 * y;
    };
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s);
    const r2 = -w0 * (zeta + s);
    solve = (y0, v0, t) => {
      const a = (v0 - r2 * y0) / (r1 - r2);
      const b = y0 - a;
      const e1 = Math.exp(r1 * t);
      const e2 = Math.exp(r2 * t);
      solved.y = a * e1 + b * e2;
      solved.dy = a * r1 * e1 + b * r2 * e2;
    };
  }
  const target = (subject: I) => axes(per(opts.to, subject));
  const { patch, state } = moving<I, O, V>(
    writes,
    { kind: 'spring', stiffness: k, damping: c, mass: m, settle },
    {
      from: (s) => axes(per(opts.from ?? opts.to, s)),
      velocity: (s) =>
        opts.velocity === undefined ? target(s).map(() => 0) : axes(per(opts.velocity, s)),
      aim: (_x, _v, was, s) => was ?? target(s),
      solve,
      settle,
      scalar: (s) => typeof per(opts.to, s) === 'number',
    },
  );
  return Object.assign(patch, {
    to: (subject: I, goal: V, at?: number) => state.change(subject, { at, to: axes(goal) }),
  }) as unknown as ReturnType<typeof spring<I, O, V>>;
}

/**
 * Coasting under friction, a fling: a subject keeps its velocity, which falls by a factor of e every
 * `ms`, and comes to rest `velocity · ms / 1000` past where it was released. `push` sets it moving
 * again from wherever it is. Closed form, so frame rate does not change where it stops.
 *
 * @category patch
 */
export function glide<I, O, V extends Value = number>(
  writes: keyof O,
  opts: Common<I, V> & {
    /** Where each subject starts. */
    from: PerSubject<I, V>;
    /** The friction's time constant, ms. Default 325, a touch scroll's. */
    ms?: number;
  },
): Moving<I, O, V> {
  const ms = opts.ms ?? 325;
  const tau = ms / 1000;
  const settle = opts.settle ?? 1e-4;
  // Released at x moving at v, a glide comes to rest at x + v·τ; y is the distance still to go,
  // which friction closes as e^(−t/τ), and its derivative at release is v again.
  const solve: Solve = (y0, _v0, t) => {
    const e = Math.exp(-t / tau);
    solved.y = y0 * e;
    solved.dy = (-y0 / tau) * e;
  };
  const { patch } = moving<I, O, V>(
    writes,
    { kind: 'glide', ms, settle },
    {
      from: (s) => axes(per(opts.from, s)),
      velocity: (s) =>
        opts.velocity === undefined
          ? axes(per(opts.from, s)).map(() => 0)
          : axes(per(opts.velocity, s)),
      aim: (x, v) => x.map((xi, i) => xi + (v[i] as number) * tau),
      solve,
      settle,
      scalar: (s) => typeof per(opts.from, s) === 'number',
    },
  );
  return patch as unknown as Moving<I, O, V>;
}
