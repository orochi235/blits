import { type Curve, curve } from './easing.js';
import { absent, Numbers } from './numbers.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import type { Easing, MotionSpec, Patch, Setting } from './types.js';

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

/**
 * One closed-form stretch: released at `at` (voice ms) from `x0` moving at `v0`, toward `to`, over
 * `secs` for a tween (0 for any other shape).
 */
interface Segment {
  at: number;
  secs: number;
  x0: number[];
  v0: number[];
  to: number[];
}

interface Change {
  /**
   * Voice ms it takes effect at; absent, until the subject's next read stamps it with that read's
   * time, for one made while no frame had met the subject.
   */
  at?: number;
  to?: number[];
  v?: number[];
}

const UNDER = 0;
const CRITICAL = 1;
const OVER = 2;
const COAST = 3;
const EASED = 4;

/**
 * A patch's law, `[form, settle, k1, k2, k3]`: which closed form its stretches follow, its `settle`,
 * and up to three constants that form reads. It heads the patch's `runs`, so `solve` finds them in
 * the buffer a sample already reads rather than in an object of their own.
 */
const HEAD = 5;

/** A motion patch's `frame` while no mix plays it: no subject has a latest frame. */
export const noFrame = (): number => Number.NaN;
export const noRevive = (): void => {};

const solved = { y: 0, dy: 0 };
/** Where every patch's `sample` leaves a value on its way to the mix; none outlives its call. */
let shared = { xs: new Float64Array(4), vs: new Float64Array(4) };

/** A subject's flags: its value is a number; it has changes pending; it has older stretches. */
const SCALAR = 1;
const PENDING = 2;
const OLDER = 4;

/**
 * The terms of a stretch that depend only on how long since its release, the same on every axis, so
 * a sample works them out once rather than once per axis.
 */
const timed = { e: 0, e2: 0, cos: 0, sin: 0 };

/** How far a tween's slope is read either side of `u`, for an easing that is only a function. */
const SPAN = 1e-4;
/**
 * Whether an evaluation wants a tween's velocity, which costs two more reads of its easing. Only
 * `read` reports it; a mix and a retarget never use it.
 */
let slope = false;
/** The last tween sample's time, curve and length, and the share of the way it had left to go. */
const memo = { dt: Number.NaN, ease: undefined as Curve | undefined, secs: 0, left: 0 };

/** `t` seconds after release, the terms every axis shares, into `timed`. */
function prepare(law: Float64Array, t: number): void {
  switch (law[0]) {
    case UNDER: {
      const zeta = law[2] as number;
      const w0 = law[3] as number;
      const wd = law[4] as number;
      timed.e = Math.exp(-zeta * w0 * t);
      timed.cos = Math.cos(wd * t);
      timed.sin = Math.sin(wd * t);
      return;
    }
    case CRITICAL: {
      const w0 = law[3] as number;
      timed.e = Math.exp(-w0 * t);
      return;
    }
    case OVER: {
      timed.e = Math.exp((law[2] as number) * t);
      timed.e2 = Math.exp((law[3] as number) * t);
      return;
    }
    default:
      timed.e = Math.exp(-t / (law[2] as number));
  }
}

/**
 * One axis, `t` seconds after release, `y0` from where it heads and moving at `v0`, into `solved`,
 * with `timed` prepared for `t`.
 */
function solve(law: Float64Array, y0: number, v0: number, t: number): void {
  switch (law[0]) {
    case UNDER: {
      const zeta = law[2] as number;
      const w0 = law[3] as number;
      const wd = law[4] as number;
      const e = timed.e;
      const b = (v0 + zeta * w0 * y0) / wd;
      const cos = timed.cos;
      const sin = timed.sin;
      const y = e * (y0 * cos + b * sin);
      solved.y = y;
      solved.dy = -zeta * w0 * y + e * wd * (b * cos - y0 * sin);
      return;
    }
    case CRITICAL: {
      const w0 = law[3] as number;
      const e = timed.e;
      const b = v0 + w0 * y0;
      const y = e * (y0 + b * t);
      solved.y = y;
      solved.dy = e * b - w0 * y;
      return;
    }
    case OVER: {
      const r1 = law[2] as number;
      const r2 = law[3] as number;
      const a = (v0 - r2 * y0) / (r1 - r2);
      const b = y0 - a;
      const e1 = timed.e;
      const e2 = timed.e2;
      solved.y = a * e1 + b * e2;
      solved.dy = a * r1 * e1 + b * r2 * e2;
      return;
    }
    default: {
      // Released at x moving at v, a glide comes to rest at x + v·τ; y is the distance still to go,
      // which friction closes as e^(−t/τ), and its derivative at release is v again.
      const tau = law[2] as number;
      const e = timed.e;
      solved.y = y0 * e;
      solved.dy = (-y0 / tau) * e;
    }
  }
}

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
  /**
   * Where `subject` is and how fast it moves at voice time `at`, default the mix's latest frame,
   * counting every change due by then. With no time given, undefined until a frame of its voice
   * has met the subject, while the subject is still inside its stagger, and once that voice is gone.
   */
  read(subject: I, at?: number): Motion<V> | undefined;
  /**
   * Sets `subject` moving at `velocity`, units per second, from voice time `at`, default the mix's
   * latest frame; for a subject no frame of its voice has met yet, or still inside its stagger, its
   * first read, after any change with a time due by then.
   */
  push(subject: I, velocity: V, at?: number): void;
};

interface Shape<I> {
  from: (subject: I) => number[];
  velocity: (subject: I) => number[];
  /** Where it heads when released from `x` at `v`, given where it was heading. */
  aim: (x: number[], v: number[], was: number[] | null, subject: I) => number[];
  /** `[form, settle, k1, k2, k3]`. */
  law: readonly number[];
  /** Whether a subject's value is a number rather than an array. */
  scalar: (subject: I) => boolean;
  /** A tween's easing, which its law cannot hold; undefined, but present, on every other shape. */
  ease: Curve | undefined;
  /** A tween's seconds for a stretch the subject starts now; undefined, but present, on the rest. */
  secs: ((subject: I) => number) | undefined;
}

/**
 * A motion patch's subjects: the stretch each is playing, in one flat array by a number the patch
 * gives it, with earlier stretches a read back may reach and changes not yet applied beside them.
 * The one copy, read by `at` and by a mix's lane alike.
 *
 * After the law, each subject's run of `stride` numbers is its release time, its flags, a tween's
 * seconds for the stretch, then `x0`, `v0` and `to` per axis. A live sample reads this one buffer and nothing else the patch owns: at
 * 10k springs of one subject each, a buffer per field, a map lookup per sample and the law in an
 * object of its own took a call from 130 ns to 490.
 */
export class Motions<I> {
  private readonly numbers = new Numbers<I>((slot) => this.forget(slot));
  private readonly slots = new Store<I, number>();
  /** Axes per subject; -1 until the first subject sets it. */
  n = -1;
  private cap = 0;
  private stride = 0;
  private runs: Float64Array;
  /**
   * Where `sample` leaves a subject's position and velocity, per axis. Shared by every patch, so
   * read it before the next sample.
   */
  xs = new Float64Array(0);
  vs = new Float64Array(0);
  private readonly pending = new Map<number, Change[]>();
  private readonly older = new Map<number, Segment[]>();
  /**
   * The subject's voice time at the mix's latest frame, which an untimed change and a `read` with
   * no time take; NaN where no frame of the patch's voice has met the subject. Set by the mix that
   * cues the patch, and put back when its voice retires.
   */
  frame: (subject: I) => number = noFrame;
  /**
   * Brings a subject its voice faded out back to it, so a change is not made for nothing. Set by
   * the mix that cues the patch, and put back when its voice retires.
   */
  revive: (subject: I) => void = noRevive;

  constructor(private readonly shape: Shape<I>) {
    this.runs = Float64Array.from(shape.law);
  }

  /** The patch's number for `subject`, made with its first stretch on first ask. */
  slot(subject: I): number {
    const known = this.slots.get(subject);
    if (known !== undefined) return known;
    const x = this.shape.from(subject);
    const v = this.shape.velocity(subject);
    const to = this.shape.aim(x, v, null, subject);
    const n = this.n < 0 ? x.length : this.n;
    for (const a of [x, v, to]) this.check(a, n);
    if (this.n < 0) {
      this.n = n;
      this.stride = 3 + 3 * n;
      if (shared.xs.length < n) shared = { xs: new Float64Array(n), vs: new Float64Array(n) };
      this.xs = shared.xs;
      this.vs = shared.vs;
    }
    const s = this.numbers.take(subject);
    this.slots.set(subject, s);
    this.grow(s + 1);
    this.runs[this.base(s) + 1] = this.shape.scalar(subject) ? SCALAR : 0;
    this.write(s, { at: 0, secs: this.shape.secs?.(subject) ?? 0, x0: x, v0: v, to });
    return s;
  }

  /** Forgets a subject, so a later ask starts it afresh from `from`. */
  release(subject: I): void {
    const s = this.slots.get(subject);
    if (s === undefined) return;
    this.slots.delete(subject);
    this.numbers.release(s);
  }

  /** Whether subject `s`'s value is a number rather than an array. */
  scalar(s: number): boolean {
    return ((this.runs[this.base(s) + 1] as number) & SCALAR) !== 0;
  }

  /** The value `at` hands the mix: the first axis for a number, a fresh array otherwise. */
  value(s: number, xs: Float64Array): number | number[] {
    if (((this.runs[this.base(s) + 1] as number) & SCALAR) !== 0) return xs[0] as number;
    const n = this.n;
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = xs[i] as number;
    return out;
  }

  /**
   * Position and velocity at voice time `t` into `xo` and `vo`, a tween's velocity left at 0. A live
   * read stamps every untimed change with `t` and commits every change due by then, in time order;
   * a projection's read applies the timed ones to a copy and commits nothing.
   */
  sample(s: number, t: number, xo: Float64Array, vo: Float64Array): void {
    if (reading.live) {
      const runs = this.runs;
      const b = this.base(s);
      if ((runs[b + 1] as number) & PENDING) this.commit(s, t);
      if ((runs[b + 1] as number) & OLDER) this.prune(s);
      const at = runs[b] as number;
      if (t < at && (runs[b + 1] as number) & OLDER)
        this.evaluateSegment(this.playing(s, t), t, xo, vo);
      else {
        const x = b + 3;
        const secs = runs[b + 2] as number;
        this.evaluate(at, secs, runs, x, runs, x + this.n, runs, x + 2 * this.n, t, xo, vo);
      }
      return;
    }
    this.peek(s, t, xo, vo);
  }

  /**
   * Whether a live `sample` at `t` would leave the subject's state as it is: nothing to stamp or
   * commit by then, and nothing older than `reading.horizon` to let go of.
   */
  quiet(s: number, t: number): boolean {
    const runs = this.runs;
    const b = this.base(s);
    const flags = runs[b + 1] as number;
    if (flags & PENDING) {
      const list = this.pending.get(s) as Change[];
      const first = (list[0] as Change).at;
      if (first === undefined || first <= t || (list[list.length - 1] as Change).at === undefined)
        return false;
    }
    if (flags & OLDER) {
      const list = this.older.get(s) as Segment[];
      const next = list.length > 1 ? (list[1] as Segment).at : (runs[b] as number);
      if (next <= reading.horizon) return false;
    }
    return true;
  }

  /** Position and velocity at `at`, default the latest frame; undefined until there is one. */
  read(subject: I, at?: number): { x: Float64Array; v: Float64Array; s: number } | undefined {
    const s = this.slots.get(subject);
    if (s === undefined) return undefined;
    const when = at ?? this.frame(subject);
    if (Number.isNaN(when)) return undefined;
    const x = new Float64Array(this.n);
    const v = new Float64Array(this.n);
    slope = true;
    try {
      this.peek(s, when, x, v);
    } finally {
      slope = false;
    }
    return { x, v, s };
  }

  /**
   * Queues a retarget or push, untimed at the latest frame, for `subject`'s next read past its time.
   * The queue keeps the changes with a time in time order, ahead of any still waiting for one.
   */
  change(subject: I, c: Change): void {
    this.revive(subject);
    const s = this.slot(subject);
    this.check(c.to, this.n);
    this.check(c.v, this.n);
    if (c.at === undefined) {
      const at = this.frame(subject);
      if (!Number.isNaN(at)) c.at = at;
    }
    const list = this.pending.get(s);
    if (list === undefined) {
      this.pending.set(s, [c]);
      this.flag(s, PENDING, true);
    } else if (c.at === undefined) list.push(c);
    else this.queue(list, c, c.at);
    reading.moved++;
  }

  /** Files a change with a time after every one due by then, ahead of those still waiting for one. */
  private queue(list: Change[], c: Change, at: number): void {
    let i = list.length;
    while (i > 0) {
      const before = (list[i - 1] as Change).at;
      if (before !== undefined && before <= at) break;
      i--;
    }
    list.splice(i, 0, c);
  }

  /** Every change due by `t` applied to a copy of the stretch playing then, committing nothing. */
  private peek(s: number, t: number, xo: Float64Array, vo: Float64Array): void {
    let seg = this.playing(s, t);
    const list = this.pending.get(s);
    if (list !== undefined)
      for (const change of list) {
        const a = change.at;
        if (a === undefined || !(a <= t)) break;
        if (a >= seg.at) seg = this.applied(s, seg, change, a);
      }
    this.evaluateSegment(seg, t, xo, vo);
  }

  private check(a: readonly number[] | undefined, n: number): void {
    if (a !== undefined && a.length !== n)
      throw new Error('blits: a motion patch moves every subject on the same number of axes');
  }

  private flag(s: number, bit: number, on: boolean): void {
    const i = this.base(s) + 1;
    const flags = this.runs[i] as number;
    this.runs[i] = on ? flags | bit : flags & ~bit;
  }

  private forget(s: number): void {
    this.pending.delete(s);
    this.older.delete(s);
  }

  /** Where subject `s`'s run starts in `runs`. */
  private base(s: number): number {
    return HEAD + s * this.stride;
  }

  private grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2);
    const runs = new Float64Array(HEAD + cap * this.stride);
    runs.set(this.runs);
    this.runs = runs;
    this.cap = cap;
  }

  private write(s: number, seg: Segment): void {
    const n = this.n;
    const b = this.base(s);
    this.runs[b] = seg.at;
    this.runs[b + 2] = seg.secs;
    for (let i = 0; i < n; i++) {
      this.runs[b + 3 + i] = seg.x0[i] as number;
      this.runs[b + 3 + n + i] = seg.v0[i] as number;
      this.runs[b + 3 + 2 * n + i] = seg.to[i] as number;
    }
  }

  /** The stretch subject `s` is playing now, as an object. */
  private latest(s: number): Segment {
    const n = this.n;
    const x = this.base(s) + 3;
    return {
      at: this.runs[this.base(s)] as number,
      secs: this.runs[this.base(s) + 2] as number,
      x0: Array.from(this.runs.subarray(x, x + n)),
      v0: Array.from(this.runs.subarray(x + n, x + 2 * n)),
      to: Array.from(this.runs.subarray(x + 2 * n, x + 3 * n)),
    };
  }

  /** The stretch playing at voice time `t`: the latest released by then, else the first. */
  private playing(s: number, t: number): Segment {
    const list = this.older.get(s);
    if (list === undefined || t >= (this.runs[this.base(s)] as number)) return this.latest(s);
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
    this.evaluateSegment(seg, at, x, v);
    const xs = Array.from(x);
    const vs = change.v ?? Array.from(v);
    const subject = this.numbers.subject(s);
    const known = subject === absent ? (undefined as I) : subject;
    const to = this.shape.aim(xs, vs, change.to ?? seg.to, known);
    const secs = subject === absent ? seg.secs : (this.shape.secs?.(known) ?? 0);
    return { at, secs, x0: xs, v0: vs, to };
  }

  private commit(s: number, t: number): void {
    const list = this.pending.get(s) as Change[];
    // The first read of a subject no frame had met: those waiting for a time take this one.
    if ((list[list.length - 1] as Change).at === undefined) {
      let i = list.length;
      while (i > 0 && (list[i - 1] as Change).at === undefined) i--;
      for (const c of list.splice(i)) {
        c.at = t;
        this.queue(list, c, t);
      }
    }
    while (list.length > 0) {
      const change = list[0] as Change;
      const a = change.at as number;
      if (a > t) break;
      list.shift();
      this.insert(s, this.applied(s, this.playing(s, a), change, a));
    }
    if (list.length === 0) {
      this.pending.delete(s);
      this.flag(s, PENDING, false);
    }
  }

  private insert(s: number, seg: Segment): void {
    let list = this.older.get(s);
    if (seg.at >= (this.runs[this.base(s)] as number)) {
      if (list === undefined) {
        list = [];
        this.older.set(s, list);
        this.flag(s, OLDER, true);
      }
      list.push(this.latest(s));
      this.write(s, seg);
      return;
    }
    if (list === undefined) {
      list = [];
      this.older.set(s, list);
      this.flag(s, OLDER, true);
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
      (list.length > 1 ? (list[1] as Segment).at : (this.runs[this.base(s)] as number)) <=
        reading.horizon
    )
      list.shift();
    if (list.length === 0) {
      this.older.delete(s);
      this.flag(s, OLDER, false);
    }
  }

  private evaluateSegment(seg: Segment, t: number, xo: Float64Array, vo: Float64Array): void {
    this.evaluate(seg.at, seg.secs, seg.x0, 0, seg.v0, 0, seg.to, 0, t, xo, vo);
  }

  private evaluate(
    at: number,
    secs: number,
    x0: ArrayLike<number>,
    x: number,
    v0: ArrayLike<number>,
    v: number,
    to: ArrayLike<number>,
    g: number,
    t: number,
    xo: Float64Array,
    vo: Float64Array,
  ): void {
    const n = this.n;
    const dt = Math.max(0, t - at) / 1000;
    const law = this.runs;
    if (law[0] === EASED) {
      this.eased(dt, secs, x0, x, to, g, xo, vo);
      return;
    }
    const settle = law[1] as number;
    let still = settle > 0;
    prepare(law, dt);
    for (let i = 0; i < n; i++) {
      const goal = to[g + i] as number;
      solve(law, (x0[x + i] as number) - goal, v0[v + i] as number, dt);
      xo[i] = goal + solved.y;
      vo[i] = solved.dy;
      if (Math.abs(solved.y) > settle || Math.abs(solved.dy) > settle) still = false;
    }
    if (still)
      for (let i = 0; i < n; i++) {
        xo[i] = to[g + i] as number;
        vo[i] = 0;
      }
  }

  /** A tween's stretch, `dt` seconds after release, kept out of `evaluate` so a spring's stays small. */
  private eased(
    dt: number,
    secs: number,
    x0: ArrayLike<number>,
    x: number,
    to: ArrayLike<number>,
    g: number,
    xo: Float64Array,
    vo: Float64Array,
  ): void {
    const ease = this.shape.ease as Curve;
    const u = dt / secs;
    // Subjects released together share `dt`, so a frame reads a bezier once, not once each.
    if (dt !== memo.dt || ease !== memo.ease || secs !== memo.secs) {
      memo.dt = dt;
      memo.ease = ease;
      memo.secs = secs;
      memo.left = u >= 1 ? 0 : 1 - ease(u);
    }
    const left = memo.left;
    let rate = 0;
    if (slope && u < 1) {
      const lo = Math.max(0, u - SPAN);
      const hi = Math.min(1, u + SPAN);
      rate = (ease(hi) - ease(lo)) / (hi - lo) / secs;
    }
    for (let i = 0; i < this.n; i++) {
      const goal = to[g + i] as number;
      const gap = (x0[x + i] as number) - goal;
      xo[i] = left === 0 ? goal : goal + gap * left;
      vo[i] = -gap * rate;
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
  const push = (subject: I, velocity: V, at?: number): void =>
    state.change(subject, { at, v: axes(velocity) });
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
  };
  states.set(patch, state as Motions<unknown>);
  return { patch, state, push };
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
  /**
   * Heads `subject` for `target` from voice time `at`, keeping its velocity: by default the mix's
   * latest frame, or for a subject no frame of its voice has met yet, or still inside its stagger,
   * its first read, after any change with a time due by then.
   */
  to(subject: I, target: V, at?: number): void;
} {
  const k = opts.stiffness ?? 170;
  const c = opts.damping ?? 26;
  const m = opts.mass ?? 1;
  const settle = opts.settle ?? 1e-4;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  let law: number[];
  if (zeta < 1) law = [UNDER, settle, zeta, w0, w0 * Math.sqrt(1 - zeta * zeta)];
  else if (zeta === 1) law = [CRITICAL, settle, 0, w0, 0];
  else {
    const s = Math.sqrt(zeta * zeta - 1);
    law = [OVER, settle, -w0 * (zeta - s), -w0 * (zeta + s), 0];
  }
  const target = (subject: I) => axes(per(opts.to, subject));
  const { patch, state, push } = moving<I, O, V>(
    writes,
    { kind: 'spring', stiffness: k, damping: c, mass: m, settle },
    {
      from: (s) => axes(per(opts.from ?? opts.to, s)),
      velocity: (s) =>
        opts.velocity === undefined ? target(s).map(() => 0) : axes(per(opts.velocity, s)),
      aim: (_x, _v, was, s) => was ?? target(s),
      law,
      scalar: (s) => typeof per(opts.to, s) === 'number',
      ease: undefined,
      secs: undefined,
    },
  );
  return Object.assign(patch, {
    push,
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
  const { patch, push } = moving<I, O, V>(
    writes,
    { kind: 'glide', ms, settle },
    {
      from: (s) => axes(per(opts.from, s)),
      velocity: (s) =>
        opts.velocity === undefined
          ? axes(per(opts.from, s)).map(() => 0)
          : axes(per(opts.velocity, s)),
      aim: (x, v) => x.map((xi, i) => xi + (v[i] as number) * tau),
      law: [COAST, settle, tau, 0, 0],
      scalar: (s) => typeof per(opts.from, s) === 'number',
      ease: undefined,
      secs: undefined,
    },
  );
  return Object.assign(patch, { push }) as unknown as Moving<I, O, V>;
}

/**
 * From one value to another over `ms` along an easing, solved in closed form, so frame rate does not
 * change where a subject is. `to(subject, target)` retargets one subject mid-flight: the new stretch
 * starts from where it is and takes the full `ms` again, so its velocity jumps where a spring's
 * would not. Time is the voice's, so `rate` and `seek` apply, and a voice's `loop` does not repeat
 * it. Cue each tween on one voice. Every subject moves on the same number of axes.
 *
 * @category patch
 */
export function tween<I, O, V extends Value = number>(
  writes: keyof O,
  opts: {
    /** Where each subject starts. */
    from: PerSubject<I, V>;
    /** Where each subject ends. */
    to: PerSubject<I, V>;
    /** How long a stretch takes, ms: asked per subject each time one of its stretches starts. */
    ms: PerSubject<I, number>;
    /** The curve from `from` to `to`. Default `'ease'`, as CSS's. */
    ease?: Easing;
  },
): Omit<Moving<I, O, V>, 'push'> & {
  /**
   * Heads `subject` for `target` from voice time `at`, over a full `ms` from where it is: by default
   * the mix's latest frame, or for a subject no frame of its voice has met yet, or still inside its
   * stagger, its first read, after any change with a time due by then.
   */
  to(subject: I, target: V, at?: number): void;
} {
  const fixed = typeof opts.ms === 'number';
  const secs = (subject: I): number => {
    const ms = per(opts.ms, subject);
    if (!(ms > 0)) throw new Error('blits: a tween takes a positive ms');
    return ms / 1000;
  };
  if (fixed) secs(undefined as I);
  const ease = opts.ease ?? 'ease';
  const target = (subject: I) => axes(per(opts.to, subject));
  const { patch, state } = moving<I, O, V>(
    writes,
    { kind: 'tween', ms: fixed ? (opts.ms as number) : undefined, ease },
    {
      from: (s) => axes(per(opts.from, s)),
      velocity: (s) => target(s).map(() => 0),
      aim: (_x, _v, was, s) => was ?? target(s),
      law: [EASED, 0, 0, 0, 0],
      scalar: (s) => typeof per(opts.to, s) === 'number',
      ease: curve(ease),
      secs,
    },
  );
  return Object.assign(patch, {
    to: (subject: I, goal: V, at?: number) => state.change(subject, { at, to: axes(goal) }),
  }) as unknown as ReturnType<typeof tween<I, O, V>>;
}
