import { applied, change, commit, cut, dueTo, insert, peek, queue, rewind } from './changes.js';
import { BOUND, closed } from './closed.js';
import type { Curve } from './easing.js';
import { closedLch } from './lch.js';
import {
  made,
  pack,
  prune,
  type Released,
  reclaim,
  release,
  restretch,
  runAt,
  runThen,
  unpack,
  unrelease,
} from './lives.js';
import { absent, Numbers } from './numbers.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import {
  type Change,
  type MotionOwner,
  numbers,
  type Run,
  RunFlag,
  type Segment,
  type Shape,
  type Watcher,
} from './stretch.js';
import { sloped } from './tweened.js';
import type { MotionSpec } from './types.js';

/**
 * A patch's law, `[form, settle, k1, k2, k3]`: which closed form its stretches follow, its `settle`,
 * and up to three constants that form reads. It heads the patch's `runs`, so `solve` finds them in
 * the buffer a sample already reads rather than in an object of their own.
 */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
export const enum Law {
  HEAD = 5,
}
const HEAD = Law.HEAD;

/** Where every patch's `sample` leaves a value on its way to the mix; none outlives its call. */
let shared = { xs: new Float64Array(4), vs: new Float64Array(4) };
/** What a patch's `xs` and `vs` are before its first subject sets its axes. */
const unsized = new Float64Array(0);

const SCALAR = RunFlag.SCALAR;
const PENDING = RunFlag.PENDING;
const OLDER = RunFlag.OLDER;
const LANDED = RunFlag.LANDED;

const wrongKind = (channel: string, holdsNumber: boolean): Error =>
  new Error(
    `blits: channel ${channel} holds ${holdsNumber ? 'a number' : 'an array'}, and this motion patch gives a subject ${holdsNumber ? 'an array' : 'a number'}`,
  );

/**
 * A motion patch's subjects: the stretch each is playing, in one flat array by a number the patch
 * gives it, with earlier stretches a read back may reach and changes not yet applied beside them.
 * The one copy, read by `at` and by a mix's lane alike.
 *
 * After the law, each subject's run of `stride` numbers is its release time, its flags, a tween's
 * ms for the stretch, then `x0`, `v0` and `to` per axis. A live sample reads this one buffer and nothing else the patch owns: at
 * 10k springs of one subject each, a buffer per field, a map lookup per sample and the law in an
 * object of its own took a call from 130 ns to 490.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: every member of `Methods` is installed below
export class Motions<I> {
  readonly numbers = new Numbers<I>(this);
  /** Numbers by subject once a second is numbered: till then the one subject is found by `numbers`. */
  readonly slots = new Store<I, number>();
  /** How many numbers have been given up, so a number kept elsewhere can tell it is stale. */
  freed = 0;
  /** Axes per subject; -1 until the first subject sets it. */
  n = -1;
  private cap = 0;
  /** Numbers in each subject's run; a run starts at `base`. Written only here. */
  stride = 0;
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
  pending: (Change[] | undefined)[] | null = null;
  older: (Segment[] | undefined)[] | null = null;
  /** By subject number, the change that released the stretch it is playing; null until one has. */
  causes: (Change | undefined)[] | null = null;
  /**
   * The mix playing the patch and its voice's id, which an untimed change and a `read` with no time
   * ask for the latest frame. Set by the mix that cues the patch, and cleared when its voice retires.
   */
  owner: MotionOwner | null = null;
  ownerId = -1;
  /** Whether the channel it was cued on holds a number; undefined until it is cued. */
  private holdsNumber: boolean | undefined = undefined;
  private channel = '';
  /** Whether the channel it was cued on is an `'oklch'` color, which its stretches go round the hue of. */
  round = false;

  /**
   * Records what the channel the patch is cued on holds, refusing a value of the other kind: at once
   * where every subject's value is one kind, else on the first sample of a subject whose value is not.
   * `round` for an `'oklch'` color.
   */
  cuedOn(channel: string, holdsNumber: boolean, round = false): void {
    if (round && this.shape.law[0] === BOUND)
      throw new Error(
        `blits: channel ${channel} goes round the hue, and a glide's bounds are a box on its OKLab axes; glide it without bounds`,
      );
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
    this.round = round;
  }

  frame(subject: I): number {
    return this.owner === null ? Number.NaN : this.owner.frame(this.ownerId, subject);
  }

  constructor(readonly shape: Shape<I>) {}

  /** The patch's number for `subject`, made with its first stretch on first ask. */
  slot(subject: I): number {
    const known = this.known(subject);
    if (known !== undefined) return known;
    const seg = this.fresh(subject);
    const s = this.take(subject);
    this.runs[this.base(s) + 1] = this.freshFlags;
    this.write(s, seg);
    return s;
  }

  /** The flags of the run `fresh` last started. */
  private freshFlags = 0;

  /** The stretch a subject met afresh starts with, its axes and the law set up for it, numbering no one. */
  fresh(subject: I): Segment {
    const x = this.shape.from(subject);
    const v = this.shape.velocity(subject, x);
    const to = this.shape.aim(x, v, null, subject, false);
    const n = this.n < 0 ? x.length : this.n;
    this.check(x, n);
    this.check(v, n);
    this.check(to, n);
    const scalar = this.shape.scalar(subject);
    if (this.holdsNumber !== undefined && scalar !== this.holdsNumber)
      throw wrongKind(this.channel, this.holdsNumber);
    if (this.n < 0) this.size(n);
    this.grow(1);
    this.freshFlags = scalar ? SCALAR : 0;
    return { at: 0, ms: this.shape.ms?.(subject) ?? 0, x0: x, v0: v, to };
  }

  /** The run `fresh` starts, as plain data. */
  freshRun(subject: I): Run {
    const seg = this.fresh(subject);
    return { flags: this.freshFlags, stretches: [seg], pending: undefined };
  }

  /** Sets the axes every subject moves on, at the first. */
  size(n: number): void {
    this.n = n;
    this.stride = 3 + 3 * n;
    if (shared.xs.length < n) shared = { xs: new Float64Array(n), vs: new Float64Array(n) };
    this.xs = shared.xs;
    this.vs = shared.vs;
  }

  /** Numbers `subject`, with room for its run. */
  take(subject: I): number {
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
  known(subject: I): number | undefined {
    if (this.numbers.size !== 1) return this.slots.get(subject);
    const only = this.numbers.subject(0);
    return only !== absent && (only === subject || Object.is(only, subject)) ? 0 : undefined;
  }

  /**
   * Subjects released at a mix time a rewind may still reach, with their run as it stood, so a
   * rewind before the release plays them on from there. Empty without history.
   */
  released: Released<I>[] = [];

  /** Whether the patch holds a run for `subject`. */
  holds(subject: I): boolean {
    return this.known(subject) !== undefined;
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
   * Copies subject `s`'s current stretch into `out` from `o` as its release time, its ms, then
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
    return this.valueOf(this.runs[this.base(s) + 1] as number, xs);
  }

  /** The value `at` hands the mix for a run with `flags`. */
  valueOf(flags: number, xs: Float64Array): number | number[] {
    if ((flags & SCALAR) !== 0) return xs[0] as number;
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
   * Where subject `s`'s run starts in `runs` (its release time, then flags, ms, `x0`, `v0`
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

  check(a: readonly number[] | undefined, n: number): void {
    if (a !== undefined && a.length !== n)
      throw new Error('blits: a motion patch moves every subject on the same number of axes');
  }

  flag(s: number, bit: number, on: boolean): void {
    this.watcher?.stretchChanged(this.watchId, s);
    const i = this.base(s) + 1;
    const flags = this.runs[i] as number;
    this.runs[i] = on ? flags | bit : flags & ~bit;
  }

  forget(s: number): void {
    this.freed++;
    if (this.pending !== null) this.pending[s] = undefined;
    if (this.older !== null) this.older[s] = undefined;
    if (this.causes !== null) this.causes[s] = undefined;
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

  write(s: number, seg: Segment): void {
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
  latest(s: number): Segment {
    const n = this.n;
    const x = this.base(s) + 3;
    return {
      at: this.runs[this.base(s)] as number,
      ms: this.runs[this.base(s) + 2] as number,
      x0: numbers(this.runs, x, n),
      v0: numbers(this.runs, x + n, n),
      to: numbers(this.runs, x + 2 * n, n),
      change: this.causes?.[s],
    };
  }

  /** The stretch playing at voice time `t`: the latest released by then, else the first. */
  playing(s: number, t: number): Segment {
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

  evaluateSegment(seg: Segment, t: number, xo: Float64Array, vo: Float64Array): void {
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
    if (this.round)
      return closedLch(this.runs, this.shape.ease, at, ms, x0, x, v0, v, to, g, t, xo, vo);
    return closed(this.runs, this.shape.ease, this.n, at, ms, x0, x, v0, v, to, g, t, xo, vo);
  }
}

const methods = {
  release,
  unrelease,
  runAt,
  pack,
  unpack,
  reclaim,
  runThen,
  restretch,
  made,
  prune,
  change,
  queue,
  peek,
  dueTo,
  rewind,
  cut,
  applied,
  commit,
  insert,
};
type Methods = typeof methods;
// biome-ignore lint/correctness/noUnusedVariables: merging needs the class's type parameters
export interface Motions<I> extends Methods {}
for (const [name, value] of Object.entries(methods))
  Object.defineProperty(Motions.prototype, name, { value, writable: true, configurable: true });
