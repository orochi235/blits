import { COAST, CRITICAL, EASED, OVER, UNDER } from './closed.js';
import { type Curve, curve } from './easing.js';
import { Motions, type Shape } from './motions.js';
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

const axes = (v: Value): number[] => (typeof v === 'number' ? [v] : [...v]);
/** Zero on every axis `x` has: a motion's velocity where its options give none. */
const still = (x: readonly number[]): number[] => new Array<number>(x.length).fill(0);
const per = <I, V>(p: PerSubject<I, V>, subject: I): V =>
  typeof p === 'function' ? (p as (s: I) => V)(subject) : p;
const scalarOf = <I, V>(p: PerSubject<I, V>): boolean | undefined =>
  typeof p === 'function' ? undefined : typeof p === 'number';
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
   * At any time, undefined for a subject the patch has never met or changed, or that the mix
   * dropped.
   */
  read(subject: I, at?: number): Motion<V> | undefined;
  /**
   * Sets `subject` moving at `velocity`, units per second, from voice time `at`, default the mix's
   * latest frame; for a subject no frame of its voice has met yet, or still inside its stagger, its
   * first read, after any change with a time due by then.
   */
  push(subject: I, velocity: V, at?: number): void;
};

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
  if (!(ms > 0)) throw new RangeError('blits: a glide takes a positive ms');
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
