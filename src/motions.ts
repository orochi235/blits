import { applied, change, commit, cut, dueTo, insert, peek, queue, rewind } from './changes.js';
import { BOUND, COAST, closed, DRIFT, REFLECT, SPEED } from './closed.js';
import type { Curve } from './easing.js';
import {
  made,
  outlived,
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
import { lastIndex } from './sorted.js';
import type { Space } from './spaces.js';
import { Store } from './store.js';
import {
  type Change,
  type MotionOwner,
  numbers,
  type Paging,
  type Run,
  RunFlag,
  type Segment,
  type Shape,
  type Watcher,
} from './stretch.js';
import { shortWay } from './turns.js';
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

/** Where `Motions.read` leaves a position and velocity, grown to the widest patch read. */
export let readScratch = { x: new Float64Array(4), v: new Float64Array(4) };

/**
 * Where each field of a subject's run sits from the run's start: its release time, its flags, a
 * tween's ms, then `x0`, with `v0` and `to` after it `n` and `2n` along.
 */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
export const enum RunField {
  AT = 0,
  FLAGS = 1,
  MS = 2,
  X0 = 3,
}

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

const notIn = (channel: string, space: Space): Error =>
  new Error(`blits: channel ${channel} ${space.is}, and a motion on it moves ${space.values}`);

/**
 * A motion patch's subjects: the stretch each is playing, in one flat array by a number the patch
 * gives it, with earlier stretches a read back may reach and changes not yet applied beside them.
 * The one copy, read by `at` and by a mix's lane alike.
 *
 * After the law, each subject's run of `stride` numbers is its release time, its flags, a tween's
 * ms for the stretch, then `x0`, `v0` and `to` per axis, and a reflecting glide's edges after
 * them, each axis's least then each axis's greatest. A live sample reads this one buffer and nothing else the patch owns: at
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
   * While a crowd row holds the patch's one run, the crowd's `hot`, the run at `origin`. Read
   * outside, at `base`, and written only here.
   */
  runs: Float64Array = unsized;
  /** Where subject 0's run starts in `runs`. */
  origin: number = HEAD;
  /** What the law is read from, its first `HEAD` numbers: `runs`, but while a crowd row holds the run. */
  lawBuf: Float64Array = unsized;
  /** The axes of the crowd row holding the run, while one does. */
  private lodgedAxes = -1;
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
  /**
   * The mix that last cued the patch, kept once its voice retires: what leaves memory after that is
   * still paged under `ownerId`, where it would otherwise be lost.
   */
  pagedBy: MotionOwner | null = null;
  /**
   * By subject, the stretches last paged where a stretch still kept may be in force by the same
   * frame, which a store keeps one record of: paged again with them. Null until one is.
   */
  paged: Map<I, Paging> | null = null;
  /** Whether the channel it was cued on holds a number; undefined until it is cued. */
  private holdsNumber: boolean | undefined = undefined;
  private channel = '';
  /**
   * The space the channel it was cued on keeps its values in, where that is no line, as round the
   * hue for `ink` or the sphere for `quat`: its stretches are solved there. Null for a line.
   */
  space: Space | null = null;
  /**
   * The full turn of the angles the channel it was cued on holds, else 0: a stretch heading for a
   * target heads the short way round, its target kept within half a turn of where it starts.
   */
  turn = 0;

  /**
   * Records what the channel the patch is cued on holds, refusing a value of the other kind: at once
   * where every subject's value is one kind, else on the first sample of a subject whose value is not.
   * `space` for a channel whose values lie in one, `turn` for one of angles.
   */
  cuedOn(channel: string, holdsNumber: boolean, space: Space | null = null, turn = 0): void {
    const form = this.shape.law[0];
    if (space !== null && (form === BOUND || form === REFLECT))
      throw new Error(
        `blits: channel ${channel} ${space.is}, and a glide's bounds are a box on its raw numbers; glide it without bounds`,
      );
    if (space !== null && form === COAST && this.shape.law[3] === SPEED)
      throw new Error(
        `blits: channel ${channel} ${space.is}, and settleOn: 'speed' stops a coast on its raw numbers; coast it with the default settleOn`,
      );
    if (space !== null && this.n >= 0 && this.n !== space.axes) throw notIn(channel, space);
    const every = this.shape.scalarEvery();
    if (every !== undefined && every !== holdsNumber) throw wrongKind(channel, holdsNumber);
    for (let s = 0; s < this.numbers.size; s++)
      if (
        this.numbers.subject(s) !== absent &&
        (((this.runs[this.base(s) + RunField.FLAGS] as number) & SCALAR) !== 0) !== holdsNumber
      )
        throw wrongKind(channel, holdsNumber);
    this.holdsNumber = holdsNumber;
    this.channel = channel;
    this.space = space;
    this.turn = turn;
  }

  /**
   * Where a stretch from `x` moving at `v` heads, as the shape aims it: for a channel of angles, a
   * target taken the short way round from `x`. A glide's rest is no target, and a fling may turn it
   * more than half a turn.
   */
  /**
   * The velocity a stretch starts with: for a drift, each axis within settle stopped, decided once
   * here in doubles, since the GPU reads the stretch in floats and must not decide it again.
   */
  moving(v: number[]): number[] {
    const law = this.shape.law;
    if (law[0] !== DRIFT) return v;
    const by = law[1] as number;
    if (by < 0) return Math.hypot(...v) <= -by ? v.map(() => 0) : v;
    return v.map((vi) => (Math.abs(vi) <= by ? 0 : vi));
  }

  aim(x: number[], v: number[], was: number[] | null, subject: I, put: boolean): number[] {
    const to = this.shape.aim(x, v, was, subject, put);
    const turn = this.turn;
    if (turn === 0) return to;
    const form = this.shape.law[0];
    if (form === COAST || form === BOUND || form === REFLECT || form === DRIFT) return to;
    const out = new Array<number>(to.length);
    for (let i = 0; i < to.length; i++) {
      const xi = x[i] as number;
      out[i] = xi - shortWay(xi - (to[i] as number), turn);
    }
    return out;
  }

  frame(subject: I): number {
    return this.owner === null ? Number.NaN : this.owner.frame(this.ownerId, subject);
  }

  constructor(readonly shape: Shape<I>) {}

  /** The patch's number for `subject`, made with its first stretch on first ask. */
  slot(subject: I): number {
    const known = this.known(subject);
    if (known !== undefined) return known;
    const first = this.firsts?.get(subject);
    const seg = first?.stretches[0] ?? this.fresh(subject);
    const s = this.take(subject);
    this.runs[this.base(s) + RunField.FLAGS] = first?.flags ?? this.freshFlags;
    this.write(s, seg);
    return s;
  }

  /**
   * The runs `freshRun` started for subjects the gpu side registered before the patch met them,
   * kept until a release, so a `from` or `velocity` that is not deterministic is asked once.
   */
  firsts: Store<I, Run> | null = null;

  /** The flags of the run `fresh` last started. */
  private freshFlags = 0;

  /** The stretch a subject met afresh starts with, its axes and the law set up for it, numbering no one. */
  fresh(subject: I): Segment {
    const x = this.shape.from(subject);
    const v = this.moving(this.shape.velocity(subject, x));
    const to = this.aim(x, v, null, subject, false);
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
    const seg: Segment = { at: 0, ms: this.shape.ms?.(subject) ?? 0, x0: x, v0: v, to };
    const edges = this.shape.edges?.(x, subject, false);
    if (edges !== undefined) seg.edges = edges;
    return seg;
  }

  /** Whether each run carries its edges after `to`, as a reflecting glide's does. */
  get reflects(): boolean {
    return this.shape.law[0] === REFLECT;
  }

  /** The run a subject the patch has not met starts with, as plain data, made once until a release. */
  freshRun(subject: I): Run {
    const had = this.firsts?.get(subject);
    if (had !== undefined) return had;
    const seg = this.fresh(subject);
    const run = { flags: this.freshFlags, stretches: [seg], pending: undefined };
    this.firsts ??= new Store();
    this.firsts.set(subject, run);
    return run;
  }

  /** Sets the axes every subject moves on, at the first. */
  size(n: number): void {
    if (this.space !== null && n !== this.space.axes) throw notIn(this.channel, this.space);
    if (this.lawBuf !== this.runs && n !== this.lodgedAxes) this.unlodge();
    this.n = n;
    this.stride = RunField.X0 + (this.reflects ? 5 : 3) * n;
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

  /** What `watch` set; called only here and in `change`, and with a number given up, in `forget`. */
  listener: ((slot: number) => void) | null = null;

  /**
   * Calls `listener` with a subject's number whenever its run or what is pending for it changes, or
   * the number is given up; null stops. Throws where another listener is attached: there is room for one.
   */
  watch(listener: ((slot: number) => void) | null): void {
    if (listener !== null && this.listener !== null && this.listener !== listener)
      throw new Error('blits: this motion patch is already watched; stop that watch first');
    this.listener = listener;
  }

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
    return this.cap === 0 ? Float64Array.from(this.shape.law) : this.lawBuf.slice(0, HEAD);
  }

  /** Whether `law` holds this patch's law, number for number, as `Object.is` compares them. */
  hasLaw(law: Float64Array): boolean {
    const own = this.cap === 0 ? this.shape.law : this.lawBuf;
    for (let i = 0; i < HEAD; i++) if (!Object.is(law[i], own[i])) return false;
    return true;
  }

  /**
   * Copies subject `s`'s current run into `out` from `o` as its release time, its flags, its ms,
   * then `x0`, `v0` and `to` per axis, unless `out` holds it there already; false, copying nothing, while it has a change pending or an
   * earlier stretch kept, which only `sample` handles.
   */
  stretchInto(s: number, out: Float64Array, o: number): boolean {
    const runs = this.runs;
    const b = this.base(s);
    if (((runs[b + RunField.FLAGS] as number) & (PENDING | OLDER)) !== 0) return false;
    if (out === runs && o === b) return true;
    if (this.reflects) return false;
    const end = RunField.X0 + 3 * this.n;
    for (let i = 0; i < end; i++) out[o + i] = runs[b + i] as number;
    return true;
  }

  /** Whether subject `s`'s value is a number rather than an array. */
  scalar(s: number): boolean {
    return ((this.runs[this.base(s) + RunField.FLAGS] as number) & SCALAR) !== 0;
  }

  /** The value `at` hands the mix: the first axis for a number, a fresh array otherwise. */
  value(s: number, xs: Float64Array): number | number[] {
    return this.valueOf(this.runs[this.base(s) + RunField.FLAGS] as number, xs);
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
      this.advance(s, t);
      const runs = this.runs;
      const b = this.base(s);
      const at = runs[b + RunField.AT] as number;
      if (t < at && (runs[b + RunField.FLAGS] as number) & OLDER)
        this.evaluateSegment(this.playing(s, t), t, xo, vo);
      else {
        const x = b + RunField.X0;
        const ms = runs[b + RunField.MS] as number;
        this.evaluateRun(at, ms, x, t, xo, vo);
      }
      return;
    }
    this.peek(s, t, xo, vo);
  }

  /**
   * What a live `sample` at `t` does before it reads: commits subject `s`'s changes due by then and
   * lets go of stretches older than `reading.horizon`.
   */
  advance(s: number, t: number): void {
    const i = this.base(s) + RunField.FLAGS;
    if ((this.runs[i] as number) & PENDING) this.commit(s, t);
    if ((this.runs[i] as number) & OLDER) this.prune(s);
  }

  /**
   * Where subject `s`'s run starts in `runs` (its release time, then flags, ms, `x0`, `v0`
   * and `to`) while it has nothing pending and no earlier stretch kept; -1 for any other.
   */
  bareAt(s: number): number {
    const b = this.base(s);
    return ((this.runs[b + RunField.FLAGS] as number) & (PENDING | OLDER)) !== 0 ? -1 : b;
  }

  /**
   * A live `sample` at `t` for a subject with nothing pending and no earlier stretch kept, true
   * then; false, writing nothing, for any other, which `quiet` and `sample` take instead.
   */
  sampleBare(s: number, t: number, xo: Float64Array, vo: Float64Array): boolean {
    const runs = this.runs;
    const b = this.bareAt(s);
    if (b < 0) return false;
    this.evaluateRun(
      runs[b + RunField.AT] as number,
      runs[b + RunField.MS] as number,
      b + RunField.X0,
      t,
      xo,
      vo,
    );
    return true;
  }

  /** The voice's `seeks` when `landed` last flagged a run landed. */
  private landedSeeks = 0;

  /**
   * Whether every subject has landed on its target at its voice time at the latest frame, as a
   * sample there would find; one with a change waiting has not. Commits nothing. `seeks` is the
   * voice's: a seek since the last ask may have taken a landed subject back into its stretch.
   */
  landed(seeks: number): boolean {
    const runs = this.runs;
    if (seeks !== this.landedSeeks) {
      this.landedSeeks = seeks;
      for (let s = 0; s < this.numbers.size; s++) {
        const b = this.base(s);
        runs[b + RunField.FLAGS] = (runs[b + RunField.FLAGS] as number) & ~LANDED;
      }
    }
    for (let s = 0; s < this.numbers.size; s++) {
      const b = this.base(s);
      const flags = runs[b + RunField.FLAGS] as number;
      if ((flags & (LANDED | PENDING)) === LANDED) continue;
      const subject = this.numbers.subject(s);
      if (subject === absent) continue;
      if (flags & PENDING) return false;
      const at = runs[b + RunField.AT] as number;
      const t = this.frame(subject);
      if (!(t >= at)) return false;
      const x = b + RunField.X0;
      const ms = runs[b + RunField.MS] as number;
      if (!this.evaluateRun(at, ms, x, t, this.xs, this.vs)) return false;
      runs[b + RunField.FLAGS] = flags | LANDED;
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
    const flags = runs[b + RunField.FLAGS] as number;
    if (flags & PENDING) {
      const list = (this.pending as Change[][])[s] as Change[];
      const first = (list[0] as Change).at;
      if (first === undefined || first <= t || (list[list.length - 1] as Change).at === undefined)
        return false;
    }
    if (flags & OLDER) {
      const list = (this.older as Segment[][])[s] as Segment[];
      const next = list.length > 1 ? (list[1] as Segment) : undefined;
      if (
        next === undefined
          ? outlived(this, runs[b + RunField.AT] as number, this.causes?.[s])
          : outlived(this, next.at, next.change)
      )
        return false;
    }
    return true;
  }

  /**
   * Whether a live `sample` of the subject changes nothing but its due changes, each of them
   * already timed, so the stretches it leaves do not depend on when it runs within a frame.
   */
  settles(s: number): boolean {
    const flags = this.runs[this.base(s) + RunField.FLAGS] as number;
    if ((flags & OLDER) !== 0 && reading.horizon !== Number.POSITIVE_INFINITY) return false;
    if ((flags & PENDING) === 0) return true;
    const list = (this.pending as Change[][])[s] as Change[];
    return (list[list.length - 1] as Change).at !== undefined;
  }

  /**
   * Position and velocity at `at`, default the latest frame, into `read`'s scratch, which the next
   * read overwrites; the subject's number, or -1 until there is a frame. A subject playing its
   * latest stretch with nothing waiting is read from its run, as a live sample reads it.
   */
  read(subject: I, at?: number): number {
    const s = this.known(subject);
    if (s === undefined) return -1;
    const when = at ?? this.frame(subject);
    if (Number.isNaN(when)) return -1;
    if (readScratch.x.length < this.n)
      readScratch = { x: new Float64Array(this.n), v: new Float64Array(this.n) };
    const { x, v } = readScratch;
    const b = this.base(s);
    const flags = this.runs[b + RunField.FLAGS] as number;
    const at0 = this.runs[b + RunField.AT] as number;
    sloped(true);
    try {
      if ((flags & PENDING) === 0 && this.dueTo(s) === undefined && !(flags & OLDER && when < at0))
        this.evaluateRun(at0, this.runs[b + RunField.MS] as number, b + RunField.X0, when, x, v);
      else this.peek(s, when, x, v);
    } finally {
      sloped(false);
    }
    return s;
  }

  check(a: readonly number[] | undefined, n: number): void {
    if (a !== undefined && a.length !== n)
      throw new Error('blits: a motion patch moves every subject on the same number of axes');
  }

  flag(s: number, bit: number, on: boolean): void {
    this.watcher?.stretchChanged(this.watchId, s);
    this.listener?.(s);
    const i = this.base(s) + RunField.FLAGS;
    const flags = this.runs[i] as number;
    this.runs[i] = on ? flags | bit : flags & ~bit;
  }

  forget(s: number): void {
    this.freed++;
    this.listener?.(s);
    if (this.pending !== null) this.pending[s] = undefined;
    if (this.older !== null) this.older[s] = undefined;
    if (this.causes !== null) this.causes[s] = undefined;
  }

  /** Where subject `s`'s run starts in `runs`. */
  base(s: number): number {
    return this.origin + s * this.stride;
  }

  private grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2);
    const runs = new Float64Array(HEAD + cap * this.stride);
    if (this.cap === 0) runs.set(this.shape.law);
    else if (this.lawBuf === this.runs) runs.set(this.runs);
    else {
      for (let i = 0; i < HEAD; i++) runs[i] = this.lawBuf[i] as number;
      for (let i = 0; i < this.stride; i++) runs[HEAD + i] = this.runs[this.origin + i] as number;
    }
    this.runs = runs;
    this.lawBuf = runs;
    this.origin = HEAD;
    this.cap = cap;
    this.lodgedAxes = -1;
  }

  /**
   * Keeps the patch's one run in a crowd row's `hot` at `at`, its law read from `law`, rather than
   * in a buffer of its own; false, changing nothing, where the patch numbers more than one subject
   * or moves on other axes than the row's `axes`.
   */
  lodge(hot: Float64Array, at: number, law: Float64Array, axes: number): boolean {
    if (this.numbers.size > 1 || (this.n >= 0 && this.n !== axes) || this.reflects) return false;
    if (this.cap > 0 && this.numbers.size === 1) {
      const b = this.base(0);
      for (let i = 0; i < this.stride; i++) hot[at + i] = this.runs[b + i] as number;
    }
    this.runs = hot;
    this.lawBuf = law;
    this.origin = at;
    this.cap = 1;
    this.lodgedAxes = axes;
    return true;
  }

  /** Whether the run is lodged in `hot` at `at`. */
  lodgedIn(hot: Float64Array, at: number): boolean {
    return this.runs === hot && this.origin === at && this.lawBuf !== hot;
  }

  /** The lodged run moved, as its crowd row did, to `hot` at `at`. */
  relodge(hot: Float64Array, at: number): void {
    this.runs = hot;
    this.origin = at;
  }

  /** Gives a lodged run a buffer of its own again, as its crowd row is let go of. */
  unlodge(): void {
    if (this.lawBuf === this.runs) return;
    const had = this.cap > 0 && this.numbers.size > 0 && this.stride > 0;
    const from = this.runs;
    const at = this.origin;
    const law = this.lawBuf;
    this.runs = unsized;
    this.lawBuf = unsized;
    this.origin = HEAD;
    this.cap = 0;
    this.lodgedAxes = -1;
    if (!had) return;
    this.grow(1);
    for (let i = 0; i < HEAD; i++) this.runs[i] = law[i] as number;
    for (let i = 0; i < this.stride; i++) this.runs[HEAD + i] = from[at + i] as number;
  }

  write(s: number, seg: Segment): void {
    const n = this.n;
    const b = this.base(s);
    this.watcher?.stretchChanged(this.watchId, s);
    this.listener?.(s);
    if (seg.change !== undefined || this.causes !== null) {
      this.causes ??= [];
      this.causes[s] = seg.change;
    }
    this.runs[b + RunField.AT] = seg.at;
    this.runs[b + RunField.FLAGS] = (this.runs[b + RunField.FLAGS] as number) & ~LANDED;
    this.runs[b + RunField.MS] = seg.ms;
    for (let i = 0; i < n; i++) {
      this.runs[b + RunField.X0 + i] = seg.x0[i] as number;
      this.runs[b + RunField.X0 + n + i] = seg.v0[i] as number;
      this.runs[b + RunField.X0 + 2 * n + i] = seg.to[i] as number;
    }
    const edges = seg.edges;
    if (edges !== undefined && this.reflects)
      for (let i = 0; i < 2 * n; i++) this.runs[b + RunField.X0 + 3 * n + i] = edges[i] as number;
  }

  /** The stretch subject `s` is playing now, as an object. */
  latest(s: number): Segment {
    const n = this.n;
    const x = this.base(s) + RunField.X0;
    return {
      at: this.runs[this.base(s) + RunField.AT] as number,
      ms: this.runs[this.base(s) + RunField.MS] as number,
      x0: numbers(this.runs, x, n),
      v0: numbers(this.runs, x + n, n),
      to: numbers(this.runs, x + 2 * n, n),
      ...(this.reflects && { edges: numbers(this.runs, x + 3 * n, 2 * n) }),
      change: this.causes?.[s],
    };
  }

  /**
   * The one stretch a read ahead finds `subject` playing at every voice time from `t` on, as `peek`
   * reads it: the changes due by `t` applied, one no read has stamped counting from when it was
   * made. Undefined where a change lands after `t`, or an earlier stretch plays at `t`.
   */
  ahead(subject: I, t: number): Segment | undefined {
    const s = this.known(subject);
    if (s === undefined) return this.firsts?.get(subject)?.stretches[0] ?? this.fresh(subject);
    const b = this.base(s);
    if (
      ((this.runs[b + RunField.FLAGS] as number) & OLDER) !== 0 &&
      t < (this.runs[b + RunField.AT] as number)
    )
      return undefined;
    let seg = this.latest(s);
    for (const change of this.dueTo(s) ?? []) {
      const a = change.at ?? change.made;
      if (a === undefined || Number.isNaN(a)) break;
      if (!(a <= t)) return undefined;
      if (a >= seg.at) seg = this.applied(subject, seg, change, a);
    }
    return seg;
  }

  /** The stretch playing at voice time `t`: the latest released by then, else the first. */
  playing(s: number, t: number): Segment {
    const list = this.older?.[s];
    if (list === undefined || t >= (this.runs[this.base(s)] as number)) return this.latest(s);
    if ((list[0] as Segment).at > t) return list[0] as Segment;
    return list[lastIndex(list, t, true)] as Segment;
  }

  evaluateSegment(seg: Segment, t: number, xo: Float64Array, vo: Float64Array): void {
    this.evaluate(seg.at, seg.ms, seg.x0, 0, seg.v0, 0, seg.to, 0, t, xo, vo, seg.edges, 0);
  }

  /** `evaluateSegment` of `latest(s)`, read from the run without building it. */
  evaluateLatest(s: number, t: number, xo: Float64Array, vo: Float64Array): void {
    const runs = this.runs;
    const b = this.base(s);
    this.evaluateRun(
      runs[b + RunField.AT] as number,
      runs[b + RunField.MS] as number,
      b + RunField.X0,
      t,
      xo,
      vo,
    );
  }

  /** `evaluate` of the run whose `x0` starts at `x` in `runs`. */
  private evaluateRun(
    at: number,
    ms: number,
    x: number,
    t: number,
    xo: Float64Array,
    vo: Float64Array,
  ): boolean {
    const runs = this.runs;
    const n = this.n;
    return this.evaluate(at, ms, runs, x, runs, x + n, runs, x + 2 * n, t, xo, vo, runs, x + 3 * n);
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
    edges: ArrayLike<number> | undefined,
    e: number,
  ): boolean {
    const space = this.space;
    if (space !== null)
      return space.closed(this.lawBuf, this.shape.ease, at, ms, x0, x, v0, v, to, g, t, xo, vo);
    const n = this.n;
    return closed(
      this.lawBuf,
      this.shape.ease,
      n,
      at,
      ms,
      x0,
      x,
      v0,
      v,
      to,
      g,
      t,
      xo,
      vo,
      edges,
      e,
    );
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
  outlived,
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
