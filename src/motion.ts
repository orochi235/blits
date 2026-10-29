import { BOUND, COAST, CRITICAL, EASED, OVER, UNDER } from './closed.js';
import { type Curve, curve } from './easing.js';
import { Motions } from './motions.js';
import { reading } from './reading.js';
import { release } from './shared.js';
import type { Shape } from './stretch.js';
import { sampleThen } from './then.js';
import type {
  Glide,
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

const axes = (v: Value): number[] => (typeof v === 'number' ? [v] : [...v]);
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
  constructor(
    writes: keyof O,
    motions: Motions<I>,
    private readonly edges: PerSubject<I, readonly [min: V, max: V]> | undefined,
  ) {
    super(writes, motions);
  }
  push(subject: I, velocity: V, at?: number): void {
    this.motions.change(subject, { at, v: axes(velocity) });
  }
  bounds(subject: I): readonly [min: V, max: V] | undefined {
    const b = this.edges;
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
  private readonly edges: PerSubject<I, readonly [min: V, max: V]> | undefined;
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
    this.start = opts.from;
    this.speed = opts.velocity;
    this.edges = opts.bounds;
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
  aim(x: number[], v: number[], _was: number[] | null, s: I, put: boolean): number[] {
    const rest = x.map((xi, i) => xi + (v[i] as number) * this.tau);
    if (this.edges === undefined) return rest;
    const [lo, hi] = per(this.edges, s);
    const min = axes(lo);
    const max = axes(hi);
    if (min.length !== rest.length || max.length !== rest.length)
      throw new Error('blits: bounds on a glide have as many axes as its subjects');
    return rest.map((r, i) => {
      const a = min[i] as number;
      const b = max[i] as number;
      const xi = x[i] as number;
      // A set past an edge stays there: a drag holds it out, and only a push lets it spring back.
      if (put && (xi < a || xi > b)) return r;
      return r < a ? a : r > b ? b : r;
    });
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
  opts: SpringOptions<I, V>,
): Spring<I, O, V> {
  const k = opts.stiffness ?? 170;
  const c = opts.damping ?? 26;
  const m = opts.mass ?? 1;
  if (!(k > 0) || !(m > 0) || !(c >= 0))
    throw new RangeError(
      'blits: a spring takes a positive stiffness and mass, and damping of 0 or more',
    );
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
  ) as unknown as Spring<I, O, V>;
}

/**
 * Coasting under friction, a fling: a subject keeps its velocity, which falls by a factor of e every
 * `ms`, and comes to rest `velocity · ms / 1000` past where it was released. `push` sets it moving
 * again from wherever it is. Closed form, so frame rate does not change where it stops.
 *
 * With `bounds`, a coast that would stop past an edge springs back to it from where it crosses, at
 * the speed it crosses at, on a critically damped spring of `stiffness`; one let go past an edge
 * springs back from there, unless it coasts back inside. A `set` past an edge leaves the subject
 * there, coasting on, until the next `push`, so a drag can hold it out.
 *
 * @category patch
 */
export function glide<I, O, V extends Value = number>(
  writes: keyof O,
  opts: GlideOptions<I, V>,
): Glide<I, O, V> {
  const ms = opts.ms ?? 325;
  if (!(ms > 0)) throw new RangeError('blits: a glide takes a positive ms');
  const k = opts.stiffness ?? 170;
  if (!(k > 0)) throw new RangeError('blits: a glide takes a positive stiffness');
  const tau = ms / 1000;
  const settle = opts.settle ?? 1e-4;
  const bounded = opts.bounds !== undefined;
  const shape = new GlideShape(
    bounded ? [BOUND, settle, tau, Math.sqrt(k), 0] : [COAST, settle, tau, 0, 0],
    bounded ? { kind: 'glide', ms, settle, stiffness: k } : { kind: 'glide', ms, settle },
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
  opts: TweenOptions<I, V>,
): Tween<I, O, V> {
  const shape = new TweenShape(opts);
  if (typeof opts.ms === 'number') shape.ms(undefined as I);
  return new TweenPatch<I, O, V>(writes, new Motions(shape)) as unknown as Tween<I, O, V>;
}
