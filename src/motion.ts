import { type Curve, curve } from './easing.js';
import { absent, Numbers } from './numbers.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import { eased, progress, sloped } from './tweened.js';
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
 * `ms` for a tween (0 for any other shape).
 */
interface Segment {
  at: number;
  ms: number;
  x0: number[];
  v0: number[];
  to: number[];
  /** The change that released it; undefined for a subject's first stretch. */
  change?: Change;
}

interface Change {
  /**
   * Voice ms it takes effect at; absent, until the subject's next read stamps it with that read's
   * time, for one made while no frame had met the subject.
   */
  at?: number;
  to?: number[];
  v?: number[];
  /** The mix clock when it was made, NaN where no mix was playing the patch. */
  made?: number;
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

/**
 * The mix playing a patch, asked with its voice's id: an owner and an id, where a pair of closures
 * cost two functions, their contexts and a weak reference per voice.
 */
export interface MotionOwner {
  /** The subject's voice time at the mix's latest frame; NaN where no frame of the voice met it. */
  frame(id: number, subject: unknown): number;
  /** Brings a subject the voice faded out back to it, so a change is not made for nothing. */
  revive(id: number, subject: unknown): void;
  /** The mix clock at its latest frame; NaN before the first. */
  now(): number;
  /** The host made a change, already given its time, which a seek makes again through `again`. */
  changed(again: () => void): void;
}

/**
 * What a mix keeping copies of a patch's stretches is told, with its id and the subject's number,
 * before one changes.
 */
export interface Watcher {
  stretchChanged(id: number, s: number): void;
}

const solved = { y: 0, dy: 0 };
/** Where every patch's `sample` leaves a value on its way to the mix; none outlives its call. */
let shared = { xs: new Float64Array(4), vs: new Float64Array(4) };
/** What a patch's `xs` and `vs` are before its first subject sets its axes. */
const unsized = new Float64Array(0);

/**
 * A subject's flags: its value is a number; it has changes pending; it has older stretches; the
 * stretch it is playing was found landed, which holds until another replaces it.
 */
const SCALAR = 1;
const PENDING = 2;
const OLDER = 4;
const LANDED = 8;

/**
 * The terms of a stretch that depend only on how long since its release, the same on every axis, so
 * a sample works them out once rather than once per axis.
 */
const timed = { e: 0, e2: 0, cos: 0, sin: 0 };

/** The law and time `timed` was last worked out for: subjects released together share them. */
const prepared = {
  form: Number.NaN,
  k1: Number.NaN,
  k2: Number.NaN,
  k3: Number.NaN,
  t: Number.NaN,
};

/** `t` seconds after release, the terms every axis shares, into `timed`. */
function prepare(law: Float64Array, t: number): void {
  const form = law[0] as number;
  const k1 = law[2] as number;
  const k2 = law[3] as number;
  const k3 = law[4] as number;
  const p = prepared;
  if (Object.is(t, p.t) && form === p.form && k1 === p.k1 && k2 === p.k2 && k3 === p.k3) return;
  p.form = form;
  p.k1 = k1;
  p.k2 = k2;
  p.k3 = k3;
  p.t = t;
  switch (form) {
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
 * with `timed` prepared for `t`. Each form is a function of its own, small enough for V8 to inline
 * wherever `closed` is: as one switch over all four it was not, and spring fills ran at two speeds.
 */
function solve(law: Float64Array, y0: number, v0: number, t: number): void {
  const form = law[0];
  if (form === UNDER) solveUnder(law, y0, v0);
  else if (form === CRITICAL) solveCritical(law, y0, v0, t);
  else if (form === OVER) solveOver(law, y0, v0);
  else solveGlide(law, y0);
}

function solveUnder(law: Float64Array, y0: number, v0: number): void {
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
}

function solveCritical(law: Float64Array, y0: number, v0: number, t: number): void {
  const w0 = law[3] as number;
  const e = timed.e;
  const b = v0 + w0 * y0;
  const y = e * (y0 + b * t);
  solved.y = y;
  solved.dy = e * b - w0 * y;
}

function solveOver(law: Float64Array, y0: number, v0: number): void {
  const r1 = law[2] as number;
  const r2 = law[3] as number;
  const a = (v0 - r2 * y0) / (r1 - r2);
  const b = y0 - a;
  const e1 = timed.e;
  const e2 = timed.e2;
  solved.y = a * e1 + b * e2;
  solved.dy = a * r1 * e1 + b * r2 * e2;
}

/**
 * Released at x moving at v, a glide comes to rest at x + v·τ; y is the distance still to go,
 * which friction closes as e^(−t/τ), and its derivative at release is v again.
 */
function solveGlide(law: Float64Array, y0: number): void {
  const tau = law[2] as number;
  const e = timed.e;
  solved.y = y0 * e;
  solved.dy = (-y0 / tau) * e;
}

const axes = (v: Value): number[] => (typeof v === 'number' ? [v] : [...v]);
/** Zero on every axis `x` has: a motion's velocity where its options give none. */
const still = (x: readonly number[]): number[] => new Array<number>(x.length).fill(0);
const per = <I, V>(p: PerSubject<I, V>, subject: I): V =>
  typeof p === 'function' ? (p as (s: I) => V)(subject) : p;
const scalarOf = <I, V>(p: PerSubject<I, V>): boolean | undefined =>
  typeof p === 'function' ? undefined : typeof p === 'number';
const wrongKind = (channel: string, holdsNumber: boolean): Error =>
  new Error(
    `blits: channel ${channel} holds ${holdsNumber ? 'a number' : 'an array'}, and this motion patch gives a subject ${holdsNumber ? 'an array' : 'a number'}`,
  );

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
  /** How fast each axis starts moving, given where it starts: still unless the options say. */
  velocity: (subject: I, x: number[]) => number[];
  /** Where it heads when released from `x` at `v`, given where it was heading. */
  aim: (x: number[], v: number[], was: number[] | null, subject: I) => number[];
  /** `[form, settle, k1, k2, k3]`. */
  law: readonly number[];
  /** Whether a subject's value is a number rather than an array. */
  scalar: (subject: I) => boolean;
  /** Whether every subject's value is a number; undefined where that depends on the subject. */
  scalarEvery(): boolean | undefined;
  /** A tween's easing, which its law cannot hold; undefined, but present, on every other shape. */
  ease: Curve | undefined;
  /** A tween's seconds for a stretch the subject starts now; undefined, but present, on the rest. */
  ms: ((subject: I) => number) | undefined;
  /** The patch's kind and constants, as `Patch.motion` reports them. */
  spec(): MotionSpec;
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
  private readonly numbers = new Numbers<I>(this);
  /** Numbers by subject once a second is numbered: till then the one subject is found by `numbers`. */
  private readonly slots = new Store<I, number>();
  /** Axes per subject; -1 until the first subject sets it. */
  n = -1;
  private cap = 0;
  private stride = 0;
  /**
   * The law, then each subject's run; empty until the first subject, the law read from `shape`.
   * Read outside, at `bareAt`, and written only here.
   */
  runs = unsized;
  /**
   * Where `sample` leaves a subject's position and velocity, per axis. Shared by every patch, so
   * read it before the next sample.
   */
  xs = unsized;
  vs = unsized;
  /**
   * By subject number, changes not yet applied and earlier stretches a read back may reach: null
   * until a subject first has one, since many patches are never changed. Each starts with room for
   * one: an empty array written at 0 reserves 17, and most patches have one subject.
   */
  private pending: (Change[] | undefined)[] | null = null;
  private older: (Segment[] | undefined)[] | null = null;
  /** By subject number, the change that released the stretch it is playing; null until one has. */
  private causes: (Change | undefined)[] | null = null;
  /**
   * The mix playing the patch and its voice's id, which an untimed change and a `read` with no time
   * ask for the latest frame. Set by the mix that cues the patch, and cleared when its voice retires.
   */
  owner: MotionOwner | null = null;
  ownerId = -1;
  /** Whether the channel it was cued on holds a number; undefined until it is cued. */
  private holdsNumber: boolean | undefined = undefined;
  private channel = '';

  /**
   * Records what the channel the patch is cued on holds, refusing a value of the other kind: at once
   * where every subject's value is one kind, else on the first sample of a subject whose value is not.
   */
  cuedOn(channel: string, holdsNumber: boolean): void {
    const every = this.shape.scalarEvery();
    if (every !== undefined && every !== holdsNumber) throw wrongKind(channel, holdsNumber);
    for (let s = 0; s < this.numbers.size; s++)
      if (
        this.numbers.subject(s) !== absent &&
        (((this.runs[this.base(s) + 1] as number) & SCALAR) !== 0) !== holdsNumber
      )
        throw wrongKind(channel, holdsNumber);
    this.holdsNumber = holdsNumber;
    this.channel = channel;
  }

  private frame(subject: I): number {
    return this.owner === null ? Number.NaN : this.owner.frame(this.ownerId, subject);
  }

  constructor(private readonly shape: Shape<I>) {}

  /** The patch's number for `subject`, made with its first stretch on first ask. */
  slot(subject: I): number {
    const known = this.known(subject);
    if (known !== undefined) return known;
    const x = this.shape.from(subject);
    const v = this.shape.velocity(subject, x);
    const to = this.shape.aim(x, v, null, subject);
    const n = this.n < 0 ? x.length : this.n;
    this.check(x, n);
    this.check(v, n);
    this.check(to, n);
    const scalar = this.shape.scalar(subject);
    if (this.holdsNumber !== undefined && scalar !== this.holdsNumber)
      throw wrongKind(this.channel, this.holdsNumber);
    if (this.n < 0) {
      this.n = n;
      this.stride = 3 + 3 * n;
      if (shared.xs.length < n) shared = { xs: new Float64Array(n), vs: new Float64Array(n) };
      this.xs = shared.xs;
      this.vs = shared.vs;
    }
    const s = this.take(subject);
    this.runs[this.base(s) + 1] = scalar ? SCALAR : 0;
    this.write(s, { at: 0, ms: this.shape.ms?.(subject) ?? 0, x0: x, v0: v, to });
    return s;
  }

  /** Numbers `subject`, with room for its run. */
  private take(subject: I): number {
    const s = this.numbers.take(subject);
    if (s === 1) {
      const first = this.numbers.subject(0);
      if (first !== absent) this.slots.set(first, 0);
    }
    if (this.numbers.size > 1) this.slots.set(subject, s);
    this.grow(s + 1);
    return s;
  }

  /** The patch's number for `subject`, undefined where it has none. */
  private known(subject: I): number | undefined {
    if (this.numbers.size !== 1) return this.slots.get(subject);
    const only = this.numbers.subject(0);
    return only !== absent && (only === subject || Object.is(only, subject)) ? 0 : undefined;
  }

  /**
   * Subjects released at a mix time a rewind may still reach, with their run as it stood, so a
   * rewind before the release plays them on from there. Empty without history.
   */
  private released: {
    subject: I;
    at: number;
    flags: number;
    stretches: Segment[];
    pending: Change[] | undefined;
  }[] = [];

  /**
   * Forgets a subject, so a later ask starts it afresh from `from`. Given the mix time `at`, under
   * history, its run is kept for a rewind before then, until `reach` passes it.
   */
  release(subject: I, at?: number, reach = Number.NEGATIVE_INFINITY): void {
    const s = this.known(subject);
    if (s === undefined) return;
    if (at !== undefined) {
      const older = this.older?.[s];
      const pending = this.pending?.[s];
      this.released = this.released.filter((e) => e.at >= reach);
      this.released.push({
        subject,
        at,
        flags: this.runs[this.base(s) + 1] as number,
        stretches: older === undefined ? [this.latest(s)] : [...older, this.latest(s)],
        pending: pending === undefined ? undefined : [...pending],
      });
    }
    this.slots.delete(subject);
    this.numbers.release(s);
  }

  /** Puts back each subject released after mix time `t`, as it stood when released. */
  private unrelease(t: number): void {
    const back = this.released.filter((e) => e.at > t).sort((a, b) => a.at - b.at);
    if (back.length === 0) return;
    this.released = this.released.filter((e) => e.at <= t);
    const done = new Set<I>();
    for (const e of back) {
      if (done.has(e.subject)) continue;
      done.add(e.subject);
      const now = this.known(e.subject);
      if (now !== undefined) {
        this.slots.delete(e.subject);
        this.numbers.release(now);
      }
      const s = this.take(e.subject);
      this.runs[this.base(s) + 1] = e.flags & ~(OLDER | PENDING);
      const latest = e.stretches[e.stretches.length - 1] as Segment;
      this.write(s, latest);
      if (e.stretches.length > 1) {
        if (this.older === null) this.older = [undefined];
        this.older[s] = e.stretches.slice(0, -1);
        this.flag(s, OLDER, true);
      }
      if (e.pending !== undefined) {
        if (this.pending === null) this.pending = [undefined];
        this.pending[s] = e.pending;
        this.flag(s, PENDING, true);
      }
    }
  }

  /**
   * Told, with `watchId`, whenever a subject's stretch or what is pending for it changes, so a mix
   * keeping a copy of it knows to read it again. Set by the mix, cleared when its voice retires. An
   * owner and an id, where a callback cost a closure and its context per patch.
   */
  watcher: Watcher | null = null;
  watchId = -1;

  /** The easing a tween's stretches follow; undefined for every other shape. */
  get ease(): Curve | undefined {
    return this.shape.ease;
  }

  /** The patch's kind and constants. */
  spec(): MotionSpec {
    return this.shape.spec();
  }

  /** A copy of the patch's law, `[form, settle, k1, k2, k3]`. */
  law(): Float64Array {
    return this.cap === 0 ? Float64Array.from(this.shape.law) : this.runs.slice(0, HEAD);
  }

  /** Whether `law` holds this patch's law, number for number, as `Object.is` compares them. */
  hasLaw(law: Float64Array): boolean {
    const own = this.cap === 0 ? this.shape.law : this.runs;
    for (let i = 0; i < HEAD; i++) if (!Object.is(law[i], own[i])) return false;
    return true;
  }

  /**
   * Copies subject `s`'s current stretch into `out` from `o` as its release time, its seconds, then
   * `x0`, `v0` and `to` per axis; false, copying nothing, while it has a change pending or an
   * earlier stretch kept, which only `sample` handles.
   */
  stretchInto(s: number, out: Float64Array, o: number): boolean {
    const runs = this.runs;
    const b = this.base(s);
    if (((runs[b + 1] as number) & (PENDING | OLDER)) !== 0) return false;
    out[o] = runs[b] as number;
    out[o + 1] = runs[b + 2] as number;
    const n3 = 3 * this.n;
    for (let i = 0; i < n3; i++) out[o + 2 + i] = runs[b + 3 + i] as number;
    return true;
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
        const ms = runs[b + 2] as number;
        this.evaluate(at, ms, runs, x, runs, x + this.n, runs, x + 2 * this.n, t, xo, vo);
      }
      return;
    }
    this.peek(s, t, xo, vo);
  }

  /**
   * Where subject `s`'s run starts in `runs` (its release time, then flags, seconds, `x0`, `v0`
   * and `to`) while it has nothing pending and no earlier stretch kept; -1 for any other.
   */
  bareAt(s: number): number {
    const b = this.base(s);
    return ((this.runs[b + 1] as number) & (PENDING | OLDER)) !== 0 ? -1 : b;
  }

  /**
   * A live `sample` at `t` for a subject with nothing pending and no earlier stretch kept, true
   * then; false, writing nothing, for any other, which `quiet` and `sample` take instead.
   */
  sampleBare(s: number, t: number, xo: Float64Array, vo: Float64Array): boolean {
    const runs = this.runs;
    const b = this.bareAt(s);
    if (b < 0) return false;
    const x = b + 3;
    const n = this.n;
    this.evaluate(
      runs[b] as number,
      runs[b + 2] as number,
      runs,
      x,
      runs,
      x + n,
      runs,
      x + 2 * n,
      t,
      xo,
      vo,
    );
    return true;
  }

  /**
   * Whether every subject has landed on its target at its voice time at the latest frame, as a
   * sample there would find; one with a change waiting has not. Commits nothing.
   */
  landed(): boolean {
    const runs = this.runs;
    const n = this.n;
    for (let s = 0; s < this.numbers.size; s++) {
      const b = this.base(s);
      const flags = runs[b + 1] as number;
      if ((flags & (LANDED | PENDING)) === LANDED) continue;
      const subject = this.numbers.subject(s);
      if (subject === absent) continue;
      if (flags & PENDING) return false;
      const at = runs[b] as number;
      const t = this.frame(subject);
      if (!(t >= at)) return false;
      const x = b + 3;
      const ms = runs[b + 2] as number;
      if (!this.evaluate(at, ms, runs, x, runs, x + n, runs, x + 2 * n, t, this.xs, this.vs))
        return false;
      runs[b + 1] = flags | LANDED;
    }
    return true;
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
      const list = (this.pending as Change[][])[s] as Change[];
      const first = (list[0] as Change).at;
      if (first === undefined || first <= t || (list[list.length - 1] as Change).at === undefined)
        return false;
    }
    if (flags & OLDER) {
      const list = (this.older as Segment[][])[s] as Segment[];
      const next = list.length > 1 ? (list[1] as Segment).at : (runs[b] as number);
      if (next <= reading.horizon) return false;
    }
    return true;
  }

  /** Position and velocity at `at`, default the latest frame; undefined until there is one. */
  read(subject: I, at?: number): { x: Float64Array; v: Float64Array; s: number } | undefined {
    const s = this.known(subject);
    if (s === undefined) return undefined;
    const when = at ?? this.frame(subject);
    if (Number.isNaN(when)) return undefined;
    const x = new Float64Array(this.n);
    const v = new Float64Array(this.n);
    sloped(true);
    try {
      this.peek(s, when, x, v);
    } finally {
      sloped(false);
    }
    return { x, v, s };
  }

  /**
   * Queues a retarget or push, untimed at the latest frame, for `subject`'s next read past its time.
   * The queue keeps the changes with a time in time order, ahead of any still waiting for one.
   */
  change(subject: I, c: Change): void {
    this.owner?.revive(this.ownerId, subject);
    const s = this.slot(subject);
    this.check(c.to, this.n);
    this.check(c.v, this.n);
    c.made = this.owner === null ? Number.NaN : this.owner.now();
    if (c.at === undefined) {
      const at = this.frame(subject);
      if (!Number.isNaN(at)) c.at = at;
    }
    const list = this.pending?.[s];
    if (list === undefined) {
      if (this.pending === null) this.pending = [undefined];
      this.pending[s] = [c];
      this.flag(s, PENDING, true);
    } else if (c.at === undefined) list.push(c);
    else this.queue(list, c, c.at);
    reading.moved++;
    const made: Change = { at: c.at, to: c.to, v: c.v };
    this.owner?.changed(() => this.change(subject, { ...made }));
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
    const list = this.pending?.[s];
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
    this.watcher?.stretchChanged(this.watchId, s);
    const i = this.base(s) + 1;
    const flags = this.runs[i] as number;
    this.runs[i] = on ? flags | bit : flags & ~bit;
  }

  forget(s: number): void {
    if (this.pending !== null) this.pending[s] = undefined;
    if (this.older !== null) this.older[s] = undefined;
    if (this.causes !== null) this.causes[s] = undefined;
  }

  /**
   * Takes back every change made after mix time `t`: each subject plays from its earliest stretch
   * kept, with the changes made by then queued to be applied again.
   */
  rewind(t: number): void {
    this.unrelease(t);
    for (let s = 0; s < this.numbers.size; s++)
      if (this.numbers.subject(s) !== absent) this.cut(s, t);
  }

  private cut(s: number, t: number): void {
    const older = this.older?.[s];
    const pending = this.pending?.[s];
    const current = this.latest(s);
    const stretches = older === undefined ? [current] : [...older, current];
    const kept: Change[] = [];
    let cut = false;
    for (const c of [...stretches.slice(1).map((seg) => seg.change), ...(pending ?? [])])
      if (c === undefined || c.made === undefined || !(c.made > t)) {
        if (c !== undefined) kept.push(c);
      } else cut = true;
    if (!cut) return;
    if (older !== undefined) {
      (this.older as (Segment[] | undefined)[])[s] = undefined;
      this.flag(s, OLDER, false);
    }
    this.write(s, stretches[0] as Segment);
    // Applied again in the order they take effect; one never stamped waits for the next read.
    const timed = kept
      .filter((c) => c.at !== undefined)
      .sort((a, b) => (a.at as number) - (b.at as number));
    const list = [...timed, ...kept.filter((c) => c.at === undefined)];
    if (list.length === 0) {
      if (pending !== undefined) {
        (this.pending as (Change[] | undefined)[])[s] = undefined;
        this.flag(s, PENDING, false);
      }
      return;
    }
    if (this.pending === null) this.pending = [undefined];
    this.pending[s] = list;
    this.flag(s, PENDING, true);
  }

  /** Where subject `s`'s run starts in `runs`. */
  base(s: number): number {
    return HEAD + s * this.stride;
  }

  private grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2);
    const runs = new Float64Array(HEAD + cap * this.stride);
    runs.set(this.cap === 0 ? this.shape.law : this.runs);
    this.runs = runs;
    this.cap = cap;
  }

  private write(s: number, seg: Segment): void {
    const n = this.n;
    const b = this.base(s);
    this.watcher?.stretchChanged(this.watchId, s);
    if (seg.change !== undefined || this.causes !== null) {
      this.causes ??= [];
      this.causes[s] = seg.change;
    }
    this.runs[b] = seg.at;
    this.runs[b + 1] = (this.runs[b + 1] as number) & ~LANDED;
    this.runs[b + 2] = seg.ms;
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
      ms: this.runs[this.base(s) + 2] as number,
      x0: Array.from(this.runs.subarray(x, x + n)),
      v0: Array.from(this.runs.subarray(x + n, x + 2 * n)),
      to: Array.from(this.runs.subarray(x + 2 * n, x + 3 * n)),
      change: this.causes?.[s],
    };
  }

  /** The stretch playing at voice time `t`: the latest released by then, else the first. */
  private playing(s: number, t: number): Segment {
    const list = this.older?.[s];
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
    const ms = subject === absent ? seg.ms : (this.shape.ms?.(known) ?? 0);
    return { at, ms, x0: xs, v0: vs, to, change };
  }

  private commit(s: number, t: number): void {
    const list = (this.pending as Change[][])[s] as Change[];
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
      (this.pending as (Change[] | undefined)[])[s] = undefined;
      this.flag(s, PENDING, false);
    }
  }

  private insert(s: number, seg: Segment): void {
    let list = this.older?.[s];
    if (list === undefined) {
      list = [];
      if (this.older === null) this.older = [undefined];
      this.older[s] = list;
      this.flag(s, OLDER, true);
    }
    if (seg.at >= (this.runs[this.base(s)] as number)) {
      list.push(this.latest(s));
      this.write(s, seg);
      return;
    }
    let i = list.length;
    while (i > 0 && (list[i - 1] as Segment).at > seg.at) i--;
    list.splice(i, 0, seg);
  }

  /** Lets go of stretches older than the one in force at `reading.horizon`. */
  private prune(s: number): void {
    const list = this.older?.[s];
    if (list === undefined) return;
    while (
      list.length > 0 &&
      (list.length > 1 ? (list[1] as Segment).at : (this.runs[this.base(s)] as number)) <=
        reading.horizon
    )
      list.shift();
    if (list.length === 0) {
      (this.older as (Segment[] | undefined)[])[s] = undefined;
      this.flag(s, OLDER, false);
    }
  }

  private evaluateSegment(seg: Segment, t: number, xo: Float64Array, vo: Float64Array): void {
    this.evaluate(seg.at, seg.ms, seg.x0, 0, seg.v0, 0, seg.to, 0, t, xo, vo);
  }

  private evaluate(
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
    return closed(this.runs, this.shape.ease, this.n, at, ms, x0, x, v0, v, to, g, t, xo, vo);
  }
}

/**
 * A stretch `t` voice ms into it, released at `at` from `x0` moving at `v0` toward `to` (each read
 * from its offset), into `xo` and `vo`: the one copy of the closed forms, which `law` (a patch's
 * `[form, settle, k1, k2, k3]`, the head of a patch's buffer or a copy of it) picks between. A tween reads `ease` and
 * `ms`, the stretch's length, dividing in milliseconds so a boundary lands exactly; every other
 * form ignores them.
 */
export function closed(
  law: Float64Array,
  ease: Curve | undefined,
  n: number,
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
  if (law[0] === EASED)
    return eased(ease as Curve, n, progress(t, at, ms), ms, x0, x, to, g, xo, vo);
  const dt = Math.max(0, t - at) / 1000;
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
  return still;
}

/** One `writes` array per channel, shared by every motion patch that writes it. */
const writesOf = new Map<PropertyKey, readonly PropertyKey[]>();

/**
 * A `'motion'` patch: its methods on the prototype, where a closure each cost a function and its
 * context per patch, and a mix may hold a patch per voice. Call them on the patch, not detached.
 */
class MotionPatch<I, O, V extends Value> {
  readonly writes: readonly (keyof O)[];
  constructor(
    writes: keyof O,
    readonly motions: Motions<I>,
  ) {
    let shared = writesOf.get(writes);
    if (shared === undefined) {
      shared = Object.freeze([writes]);
      writesOf.set(writes, shared);
    }
    this.writes = shared as readonly (keyof O)[];
  }
  readonly form = 'motion' as const;
  readonly duration = 0;
  readonly period = 0;
  get motion(): MotionSpec {
    return this.motions.spec();
  }
  at(_phase: number, subject: I, setting: Setting<void>): Partial<O> {
    const state = this.motions;
    const s = state.slot(subject);
    state.sample(s, setting.elapsed, state.xs, state.vs);
    return { [this.writes[0] as keyof O]: state.value(s, state.xs) } as Partial<O>;
  }
  read(subject: I, at?: number): Motion<V> | undefined {
    const state = this.motions;
    const r = state.read(subject, at);
    if (r === undefined) return undefined;
    return { value: state.value(r.s, r.x) as V, velocity: state.value(r.s, r.v) as V };
  }
}

class TweenPatch<I, O, V extends Value> extends MotionPatch<I, O, V> {
  to(subject: I, goal: V, at?: number): void {
    this.motions.change(subject, { at, to: axes(goal) });
  }
}

class SpringPatch<I, O, V extends Value> extends TweenPatch<I, O, V> {
  push(subject: I, velocity: V, at?: number): void {
    this.motions.change(subject, { at, v: axes(velocity) });
  }
}

class GlidePatch<I, O, V extends Value> extends MotionPatch<I, O, V> {
  push(subject: I, velocity: V, at?: number): void {
    this.motions.change(subject, { at, v: axes(velocity) });
  }
}

/** The state behind a `'motion'` patch, for an engine that reads it directly. */
export function motionOf<I>(p: object): Motions<I> | undefined {
  return p instanceof MotionPatch ? (p.motions as Motions<I>) : undefined;
}

/**
 * The shapes of the stock motions, each one object over the options it reads, copied out of them so
 * the caller's object is not kept: a closure per question cost a function and its context per
 * patch, and a mix may hold a patch per voice.
 */
class SpringShape<I, V extends Value> implements Shape<I> {
  readonly ease = undefined;
  readonly ms = undefined;
  private readonly goal: PerSubject<I, V>;
  private readonly start: PerSubject<I, V>;
  private readonly speed: PerSubject<I, V> | undefined;
  constructor(
    readonly law: readonly number[],
    private readonly motion: MotionSpec,
    opts: { to: PerSubject<I, V>; from?: PerSubject<I, V>; velocity?: PerSubject<I, V> },
  ) {
    this.goal = opts.to;
    this.start = opts.from ?? opts.to;
    this.speed = opts.velocity;
  }
  spec(): MotionSpec {
    return this.motion;
  }
  from(s: I): number[] {
    return axes(per(this.start, s));
  }
  velocity(s: I, x: number[]): number[] {
    const v = this.speed;
    return v === undefined ? still(x) : axes(per(v, s));
  }
  aim(_x: number[], _v: number[], was: number[] | null, s: I): number[] {
    return was ?? axes(per(this.goal, s));
  }
  scalar(s: I): boolean {
    return typeof per(this.goal, s) === 'number';
  }
  scalarEvery(): boolean | undefined {
    return scalarOf(this.goal);
  }
}

class GlideShape<I, V extends Value> implements Shape<I> {
  readonly ease = undefined;
  readonly ms = undefined;
  private readonly start: PerSubject<I, V>;
  private readonly speed: PerSubject<I, V> | undefined;
  constructor(
    readonly law: readonly number[],
    private readonly motion: MotionSpec,
    opts: { from: PerSubject<I, V>; velocity?: PerSubject<I, V> },
    private readonly tau: number,
  ) {
    this.start = opts.from;
    this.speed = opts.velocity;
  }
  spec(): MotionSpec {
    return this.motion;
  }
  from(s: I): number[] {
    return axes(per(this.start, s));
  }
  velocity(s: I, x: number[]): number[] {
    const v = this.speed;
    return v === undefined ? still(x) : axes(per(v, s));
  }
  aim(x: number[], v: number[]): number[] {
    return x.map((xi, i) => xi + (v[i] as number) * this.tau);
  }
  scalar(s: I): boolean {
    return typeof per(this.start, s) === 'number';
  }
  scalarEvery(): boolean | undefined {
    return scalarOf(this.start);
  }
}

const EASED_LAW: readonly number[] = [EASED, 0, 0, 0, 0];

class TweenShape<I, V extends Value> implements Shape<I> {
  readonly law = EASED_LAW;
  readonly ease: Curve;
  private readonly easing: Easing;
  private readonly start: PerSubject<I, V>;
  private readonly goal: PerSubject<I, V>;
  private readonly length: PerSubject<I, number>;
  constructor(opts: {
    from: PerSubject<I, V>;
    to: PerSubject<I, V>;
    ms: PerSubject<I, number>;
    ease?: Easing;
  }) {
    this.easing = opts.ease ?? 'ease';
    this.ease = curve(this.easing);
    this.start = opts.from;
    this.goal = opts.to;
    this.length = opts.ms;
  }
  spec(): MotionSpec {
    const ms = this.length;
    return { kind: 'tween', ms: typeof ms === 'number' ? ms : undefined, ease: this.easing };
  }
  from(s: I): number[] {
    return axes(per(this.start, s));
  }
  velocity(_s: I, x: number[]): number[] {
    return still(x);
  }
  aim(_x: number[], _v: number[], was: number[] | null, s: I): number[] {
    return was ?? axes(per(this.goal, s));
  }
  scalar(s: I): boolean {
    return typeof per(this.goal, s) === 'number';
  }
  scalarEvery(): boolean | undefined {
    return scalarOf(this.goal);
  }
  ms(s: I): number {
    const length = per(this.length, s);
    if (!(length > 0)) throw new Error('blits: a tween takes a positive ms');
    return length;
  }
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
  const motion: MotionSpec = { kind: 'spring', stiffness: k, damping: c, mass: m, settle };
  return new SpringPatch<I, O, V>(
    writes,
    new Motions(new SpringShape(law, motion, opts)),
  ) as unknown as ReturnType<typeof spring<I, O, V>>;
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
  const shape = new GlideShape(
    [COAST, settle, tau, 0, 0],
    { kind: 'glide', ms, settle },
    opts,
    tau,
  );
  return new GlidePatch<I, O, V>(writes, new Motions(shape)) as unknown as Moving<I, O, V>;
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
  const shape = new TweenShape(opts);
  if (typeof opts.ms === 'number') shape.ms(undefined as I);
  return new TweenPatch<I, O, V>(writes, new Motions(shape)) as unknown as ReturnType<
    typeof tween<I, O, V>
  >;
}
