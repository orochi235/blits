import {
  BOUND,
  backs,
  COAST,
  CRITICAL,
  coastRest,
  DRIFT,
  EASED,
  OVER,
  REFLECT,
  reflected,
  SPEED,
  STOP,
  UNDER,
  walked,
} from './closed.js';
import { type Curve, curve } from './easing.js';
import { Motions, readScratch } from './motions.js';
import { reading } from './reading.js';
import { release } from './shared.js';
import type { Shape } from './stretch.js';
import { sampleThen } from './then.js';
import type {
  Glide,
  GlideEdge,
  GlideOptions,
  Motion,
  PerSubject,
  Spring,
  SpringOptions,
  Tween,
  TweenOptions,
  Value,
} from './types/motion.js';
import type { Easing, MotionSpec, Setting } from './types.js';

export type {
  Glide,
  GlideEdge,
  GlideOptions,
  Motion,
  MotionOptions,
  Moving,
  PerSubject,
  Spring,
  SpringOptions,
  Tween,
  TweenOptions,
  Value,
} from './types/motion.js';

/** A value's axes as a new array: a number is one axis. */
export const axes = (v: Value): number[] => (typeof v === 'number' ? [v] : [...v]);
/** Zero on every axis `x` has: a motion's velocity where its options give none. */
const still = (x: readonly number[]): number[] => new Array<number>(x.length).fill(0);
const per = <I, V>(p: PerSubject<I, V>, subject: I): V =>
  typeof p === 'function' ? (p as (s: I) => V)(subject) : p;
const scalarOf = <I, V>(p: PerSubject<I, V>): boolean | undefined =>
  typeof p === 'function' ? undefined : typeof p === 'number';
/**
 * What marks a motion patch to every copy of blits of this release loaded in one realm, so a
 * spring another copy made runs on this copy's lanes; it gives the patch's state.
 */
const MOTIONS = Symbol.for(`@msb235/blits/motions@${release}`);

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
  get motion(): MotionSpec {
    return this.motions.spec();
  }
  get [MOTIONS](): Motions<I> {
    return this.motions;
  }
  at(_phase: number, subject: I, setting: Setting<void>): Partial<O> {
    const state = this.motions;
    const back = reading.back;
    if (back !== null) {
      const flags = sampleThen(state, subject, setting.elapsed, back);
      return { [this.writes[0] as keyof O]: state.valueOf(flags, state.xs) } as Partial<O>;
    }
    const s = state.slot(subject);
    state.sample(s, setting.elapsed, state.xs, state.vs);
    return { [this.writes[0] as keyof O]: state.value(s, state.xs) } as Partial<O>;
  }
  set(subject: I, value: V, at?: number): void {
    this.motions.change(subject, { at, x: axes(value) });
  }
  read(subject: I, at?: number): Motion<V> | undefined {
    const state = this.motions;
    const s = state.read(subject, at);
    if (s < 0) return undefined;
    return {
      value: state.value(s, readScratch.x) as V,
      velocity: state.value(s, readScratch.v) as V,
    };
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
  constructor(
    writes: keyof O,
    motions: Motions<I>,
    private readonly limits: PerSubject<I, readonly [min: V, max: V]> | undefined,
  ) {
    super(writes, motions);
  }
  push(subject: I, velocity: V, at?: number): void {
    this.motions.change(subject, { at, v: axes(velocity) });
  }
  bounds(subject: I): readonly [min: V, max: V] | undefined {
    const b = this.limits;
    return b === undefined ? undefined : per(b, subject);
  }
}

/**
 * The state behind a `'motion'` patch, for an engine that reads it directly; a patch another copy
 * of the same release made counts.
 */
export function motionOf<I>(p: object): Motions<I> | undefined {
  return p instanceof MotionPatch
    ? (p.motions as Motions<I>)
    : (p as { [MOTIONS]?: Motions<I> })[MOTIONS];
}

/**
 * The shapes of the stock motions, each one object over the options it reads, copied out of them so
 * the caller's object is not kept: a closure per question cost a function and its context per
 * patch, and a mix may hold a patch per voice.
 */
abstract class StockShape<I, V extends Value> {
  /**
   * `goal` is where a stretch heads with nothing aimed before, and its type says whether a subject
   * is a number; a glide, which aims by its own law, passes its start.
   */
  constructor(
    protected readonly start: PerSubject<I, V>,
    private readonly speed: PerSubject<I, V> | undefined,
    private readonly goal: PerSubject<I, V>,
  ) {}
  from(s: I): number[] {
    return axes(per(this.start, s));
  }
  velocity(s: I, x: number[]): number[] {
    const v = this.speed;
    return v === undefined ? still(x) : axes(per(v, s));
  }
  aim(_x: number[], _v: number[], was: number[] | null, s: I, _put: boolean): number[] {
    return was ?? axes(per(this.goal, s));
  }
  scalar(s: I): boolean {
    return typeof per(this.goal, s) === 'number';
  }
  scalarEvery(): boolean | undefined {
    return scalarOf(this.goal);
  }
}

class SpringShape<I, V extends Value> extends StockShape<I, V> implements Shape<I> {
  readonly ease = undefined;
  readonly ms = undefined;
  constructor(
    readonly law: readonly number[],
    private readonly motion: MotionSpec,
    opts: { to: PerSubject<I, V>; from?: PerSubject<I, V>; velocity?: PerSubject<I, V> },
  ) {
    super(opts.from ?? opts.to, opts.velocity, opts.to);
  }
  spec(): MotionSpec {
    return this.motion;
  }
  /** With no stiffness nothing pulls toward the target: it coasts to where damping stops it. */
  override aim(x: number[], v: number[], was: number[] | null, s: I, put: boolean): number[] {
    const form = this.law[0];
    if (form === COAST) return coastRest(this.law, x, v);
    if (form === DRIFT) return x.slice();
    return super.aim(x, v, was, s, put);
  }
}

class GlideShape<I, V extends Value> extends StockShape<I, V> implements Shape<I> {
  readonly ease = undefined;
  readonly ms = undefined;
  private readonly limits: PerSubject<I, readonly [min: V, max: V]> | undefined;
  constructor(
    readonly law: readonly number[],
    private readonly motion: MotionSpec,
    opts: {
      from: PerSubject<I, V>;
      velocity?: PerSubject<I, V>;
      bounds?: PerSubject<I, readonly [min: V, max: V]>;
    },
    private readonly tau: number,
  ) {
    super(opts.from, opts.velocity, opts.from);
    this.limits = opts.bounds;
  }
  spec(): MotionSpec {
    return this.motion;
  }
  override aim(x: number[], v: number[], _was: number[] | null, s: I, put: boolean): number[] {
    if (this.limits === undefined) return coastRest(this.law, x, v);
    const rest = x.map((xi, i) => xi + (v[i] as number) * this.tau);
    const [min, max] = this.box(x, s);
    const reflect = this.law[0] === REFLECT;
    return rest.map((r, i) => {
      const a = min[i] as number;
      const b = max[i] as number;
      const xi = x[i] as number;
      // A set past an edge stays there: a drag holds it out, and only a push lets it spring back.
      if (put && (xi < a || xi > b)) return r;
      if (!reflect || backs(this.tau, a, b, xi, v[i] as number)) return r < a ? a : r > b ? b : r;
      reflected(
        this.tau,
        this.law[4] as number,
        a,
        b,
        xi,
        v[i] as number,
        Number.POSITIVE_INFINITY,
      );
      return walked.x;
    });
  }

  edges(x: number[], s: I, put: boolean): number[] | undefined {
    if (this.law[0] !== REFLECT) return undefined;
    const [min, max] = this.box(x, s);
    const n = x.length;
    const out = new Array<number>(2 * n);
    for (let i = 0; i < n; i++) {
      const a = min[i] as number;
      const b = max[i] as number;
      const xi = x[i] as number;
      // A set past an edge coasts on as an unbounded glide; MAX_VALUE, not Infinity, survives JSON.
      const free = put && (xi < a || xi > b);
      out[i] = free ? -Number.MAX_VALUE : a;
      out[n + i] = free ? Number.MAX_VALUE : b;
    }
    return out;
  }

  /** Subject `s`'s least and greatest edge per axis. */
  private box(x: number[], s: I): [number[], number[]] {
    const [lo, hi] = per(this.limits as PerSubject<I, readonly [min: V, max: V]>, s);
    const min = axes(lo);
    const max = axes(hi);
    if (min.length !== x.length || max.length !== x.length)
      throw new Error('blits: bounds on a glide have as many axes as its subjects');
    return [min, max];
  }
}

const EASED_LAW: readonly number[] = [EASED, 0, 0, 0, 0];

/** A glide's `edge`, checked, with a reflect of 0 taken as the stop it is. */
function edgeOf(edge: GlideEdge | undefined): 'spring' | 'stop' | { readonly reflect: number } {
  if (edge === undefined || edge === 'spring') return 'spring';
  if (edge === 'stop') return 'stop';
  const r = typeof edge === 'object' && edge !== null ? edge.reflect : Number.NaN;
  if (!(r >= 0 && r <= 1))
    throw new RangeError(
      "blits: a glide's edge is 'spring', 'stop' or { reflect: r } with r from 0 to 1",
    );
  return r === 0 ? 'stop' : { reflect: r };
}

/** Whether `settleOn` asks a coast to land on its speed alone; `coast` says whether it is one. */
function slowing(on: 'reach' | 'speed' | undefined, coast: boolean, what: string): boolean {
  if (on !== undefined && on !== 'reach' && on !== 'speed')
    throw new RangeError(`blits: settleOn is 'reach' or 'speed', not ${String(on)}`);
  if (on !== 'speed') return false;
  if (!coast) throw new RangeError(`blits: settleOn: 'speed' is for a coast, and ${what}`);
  return true;
}

/** A law's settle: negative where it measures a length over the axes (`closed`, `Motions.moving`). */
function settleLaw(settle: number, by: 'axis' | 'length' | undefined): number {
  if (!(settle >= 0 && settle < Infinity))
    throw new RangeError('blits: a motion patch takes a finite settle of 0 or more');
  if (by !== undefined && by !== 'axis' && by !== 'length')
    throw new RangeError(`blits: settleBy is 'axis' or 'length', not ${String(by)}`);
  return by === 'length' ? -settle : settle;
}

class TweenShape<I, V extends Value> extends StockShape<I, V> implements Shape<I> {
  readonly law = EASED_LAW;
  readonly ease: Curve;
  private readonly easing: Easing;
  private readonly length: PerSubject<I, number>;
  constructor(opts: {
    from: PerSubject<I, V>;
    to: PerSubject<I, V>;
    ms: PerSubject<I, number>;
    ease?: Easing;
  }) {
    super(opts.from, undefined, opts.to);
    this.easing = opts.ease ?? 'ease';
    this.ease = curve(this.easing);
    this.length = opts.ms;
  }
  spec(): MotionSpec {
    const ms = this.length;
    return { kind: 'tween', ms: typeof ms === 'number' ? ms : undefined, ease: this.easing };
  }
  ms(s: I): number {
    const length = per(this.length, s);
    if (!(length > 0)) throw new Error('blits: a tween takes a positive ms');
    return length;
  }
}

/**
 * A damped spring toward a target, solved in closed form. {@link Spring.to | `to(subject, target)`} retargets one
 * subject mid-flight, and the new stretch starts from where it is and how fast it moves, so there is
 * no kink. Time is the voice's, so `rate` and `seek` apply. Its state is its own, kept per subject:
 * cue each spring on one voice. Every subject moves on the same number of axes.
 *
 * @category patch
 */
export function spring<I, O, V extends Value = number>(
  writes: keyof O,
  opts: SpringOptions<I, V>,
): Spring<I, O, V> {
  const k = opts.stiffness ?? 170;
  const c = opts.damping ?? 26;
  const m = opts.mass ?? 1;
  if (!(m > 0 && m < Infinity) || !(k >= 0 && k < Infinity) || !(c >= 0 && c < Infinity))
    throw new RangeError(
      'blits: a spring takes a finite positive mass, and finite stiffness and damping of 0 or more',
    );
  const settle = opts.settle ?? 1e-4;
  const by = settleLaw(settle, opts.settleBy);
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  let law: number[];
  const slow = slowing(opts.settleOn, k === 0, 'a spring with stiffness pulls toward its target');
  if (k === 0) law = c === 0 ? [DRIFT, by, 0, 0, 0] : [COAST, by, m / c, slow ? SPEED : 0, 0];
  else if (zeta < 1) law = [UNDER, by, zeta, w0, w0 * Math.sqrt(1 - zeta * zeta)];
  else if (zeta === 1) law = [CRITICAL, by, 0, w0, 0];
  else {
    const s = Math.sqrt(zeta * zeta - 1);
    law = [OVER, by, -w0 * (zeta - s), -w0 * (zeta + s), 0];
  }
  const motion: MotionSpec = {
    kind: 'spring',
    stiffness: k,
    damping: c,
    mass: m,
    settle,
    ...(opts.settleBy === 'length' && { settleBy: 'length' }),
    ...(slow && { settleOn: 'speed' }),
  };
  return new SpringPatch<I, O, V>(
    writes,
    new Motions(new SpringShape(law, motion, opts)),
  ) as unknown as Spring<I, O, V>;
}

/**
 * A patch that coasts each subject to a stop under friction, as after a fling. A subject keeps its
 * velocity, which falls by a factor of e every {@link GlideOptions.ms | `ms`}, and comes to rest `velocity · ms / 1000` past
 * where it was released. {@link Glide.push | `push`} sets it moving again from wherever it is. Closed form, so frame
 * rate does not change where it stops.
 *
 * With `bounds`, a coast that would stop past an edge springs back to it from where it crosses, at
 * the speed it crosses at, on a critically damped spring of {@link GlideOptions.stiffness | `stiffness`}; one let go past an edge
 * springs back from there, unless it coasts back inside. A {@link Glide.set | `set`} past an edge leaves the subject
 * there, coasting on, until the next {@link Glide.push | `push`}, so a drag can hold it out.
 *
 * @category patch
 */
export function glide<I, O, V extends Value = number>(
  writes: keyof O,
  opts: GlideOptions<I, V>,
): Glide<I, O, V> {
  const ms = opts.ms ?? 325;
  if (!(ms > 0 && ms < Infinity)) throw new RangeError('blits: a glide takes a finite positive ms');
  const k = opts.stiffness ?? 170;
  if (!(k > 0 && k < Infinity))
    throw new RangeError('blits: a glide takes a finite positive stiffness');
  const tau = ms / 1000;
  const settle = opts.settle ?? 1e-4;
  const by = settleLaw(settle, opts.settleBy);
  const bounded = opts.bounds !== undefined;
  const slow = slowing(opts.settleOn, !bounded, 'its bounds spring it back');
  const length = opts.settleBy === 'length' && { settleBy: 'length' as const };
  const edge = edgeOf(opts.edge);
  const law =
    edge === 'spring'
      ? [BOUND, by, tau, Math.sqrt(k), 0]
      : edge === 'stop'
        ? [BOUND, by, tau, Math.sqrt(k), STOP]
        : [REFLECT, by, tau, Math.sqrt(k), edge.reflect];
  const shape = new GlideShape(
    bounded ? law : [COAST, by, tau, slow ? SPEED : 0, 0],
    bounded
      ? {
          kind: 'glide',
          ms,
          settle,
          ...length,
          ...(edge !== 'spring' && { edge }),
          stiffness: k,
        }
      : { kind: 'glide', ms, settle, ...length, ...(slow && { settleOn: 'speed' as const }) },
    opts,
    tau,
  );
  return new GlidePatch<I, O, V>(writes, new Motions(shape), opts.bounds) as unknown as Glide<
    I,
    O,
    V
  >;
}

/**
 * From one value to another over {@link TweenOptions.ms | `ms`} along an easing. Solved in closed form, so frame rate does
 * not change where a subject is. {@link Tween.to | `to(subject, target)`} retargets one subject mid-flight: the new
 * stretch starts from where it is and takes the full {@link TweenOptions.ms | `ms`} again, so its velocity jumps where a
 * spring's would not. Time is the voice's, so `rate` and `seek` apply, and a voice's {@link VoiceSpec.loop | `loop`} does
 * not repeat it. Cue each tween on one voice. Every subject moves on the same number of axes.
 *
 * @category patch
 */
export function tween<I, O, V extends Value = number>(
  writes: keyof O,
  opts: TweenOptions<I, V>,
): Tween<I, O, V> {
  const shape = new TweenShape(opts);
  if (typeof opts.ms === 'number') shape.ms(undefined as I);
  return new TweenPatch<I, O, V>(writes, new Motions(shape)) as unknown as Tween<I, O, V>;
}
