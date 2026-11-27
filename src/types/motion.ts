import type { Easing, Patch } from './patch.js';

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
 * Where a subject is and how fast it is moving. At one moment of voice time.
 *
 * @category patch
 */
export interface Motion<V extends Value = number> {
  value: V;
  /** How fast `value` is changing, in its units per second. */
  velocity: V;
}

/**
 * A patch whose motion is a closed form per subject. It lands in the same place at any frame rate,
 * and its changes mid-flight start from where the subject is and how fast it moves. It moves the
 * way the channel it writes goes between two values: round the short way on an `angle`, along the
 * sphere on a `quat`, by its parts on an `affine`, round the hue on an `ink`.
 *
 * @category patch
 */
export interface Moving<I, O, V extends Value> extends Patch<I, O, void> {
  /**
   * Where `subject` is and how fast it moves at voice ms `at`, on its voice's clock. `at` defaults to the mix's latest
   * frame, counting every change due by then. With no time given, undefined until a frame of its
   * voice has met the subject, while the subject is still inside its stagger, and once that voice
   * is gone. At any time, undefined for a subject the patch has never met or changed, or that the
   * mix dropped.
   */
  read(subject: I, at?: number): Motion<V> | undefined;
  /**
   * Sets `subject` moving at `velocity`, units per second, from voice time `at`. `at` defaults to
   * the mix's latest frame; for a subject no frame of its voice has met yet, or still inside its
   * stagger, its first read, after any change with a time due by then. A subject faded out of the
   * voice comes back at the latest frame too, however long it is before it is next read.
   */
  push(subject: I, velocity: V, at?: number): void;
  /**
   * Puts `subject` at `value` from voice time `at`, keeping its velocity. `at` defaults as {@link Moving.push | `push`}'s
   * does. A spring or tween heads for its target from there, a glide coasts on from there.
   */
  set(subject: I, value: V, at?: number): void;
}

/**
 * What `spring` and `glide` both take.
 *
 * @category patch
 */
export interface MotionOptions<I, V extends Value> {
  /** Units per second each subject starts moving at. Default 0. */
  velocity?: PerSubject<I, V>;
  /**
   * How near and slow a subject must be to land exactly where it heads. Within this distance of
   * where it heads, and this slow, a subject lands there exactly, so a mix can see it at rest.
   * Default 1e-4; 0 keeps the curve exact.
   */
  settle?: number;
  /**
   * How `settle` measures near and slow. `'axis'` (the default) holds each axis to it on its own;
   * `'length'` holds the distance still to go, and the speed, each as one length over every axis,
   * as a Euclidean rest threshold does. On one axis the two are the same.
   */
  settleBy?: 'axis' | 'length';
  /**
   * What a coast (a spring with no stiffness, or a glide with no bounds) must do to land. `'reach'`
   * (the default) lands it within `settle` of where friction would stop it, and that slow;
   * `'speed'` lands it once its speed is within `settle`, where it stands then, which it heads for
   * from release, so the curve stops there with no jump. A momentum scroll that ends once too slow
   * to see is the case for it. Anything else with `'speed'` throws: a spring with stiffness, which
   * is slowest at the far end of each swing, or a glide with bounds.
   */
  settleOn?: 'reach' | 'speed';
}

/**
 * What `spring` takes.
 *
 * @category patch
 */
export interface SpringOptions<I, V extends Value> extends MotionOptions<I, V> {
  to: PerSubject<I, V>;
  /** Where each subject starts. Default: `to`, at rest. */
  from?: PerSubject<I, V>;
  /**
   * How hard the spring pulls toward its target, per second squared. Default 170. At 0 nothing
   * pulls: a subject coasts as a `glide` of `ms` `1000 · mass / damping` does, and a target changes
   * nothing.
   */
  stiffness?: number;
  /**
   * How fast the spring's motion dies away, per second. Default 26, just short of critical at the
   * default stiffness. At 0 a spring oscillates about its target for good; with no stiffness
   * either, a subject moves on at its velocity.
   */
  damping?: number;
  /** Positive. Default 1. */
  mass?: number;
}

/**
 * What `glide` takes.
 *
 * @category patch
 */
export interface GlideOptions<I, V extends Value> extends MotionOptions<I, V> {
  /** Where each subject starts. */
  from: PerSubject<I, V>;
  /**
   * The friction's time constant, ms, not a duration as a tween's `ms` is: each `ms` that passes
   * takes the speed down to 37% of what it was. Default 325, a touch scroll's.
   */
  ms?: number;
  /** The least and greatest value a coast comes to rest at, per axis. Default none. */
  bounds?: PerSubject<I, readonly [min: V, max: V]>;
  /**
   * What an edge of `bounds` does to a coast that reaches it, on that axis alone. `'spring'` (the
   * default) lets it coast on past the edge and springs it back; `'stop'` stops it on the edge;
   * `{ reflect: r }` turns it back off the edge with `r` of the speed it met the edge at, 1 for
   * every bit of it and 0 to stop, coasting on from there under the same friction, off the far edge
   * too if it gets that far. Whatever the edge, a subject let go past one springs back to it unless
   * it coasts back inside.
   */
  edge?: GlideEdge;
  /** The spring back's, per second squared, with `bounds`. Default 170, as a spring's. */
  stiffness?: number;
}

/**
 * What an edge of a glide's `bounds` does to a coast that reaches it.
 *
 * @category patch
 */
export type GlideEdge = 'spring' | 'stop' | { readonly reflect: number };

/**
 * What `tween` takes.
 *
 * @category patch
 */
export interface TweenOptions<I, V extends Value> {
  /** Where each subject starts. */
  from: PerSubject<I, V>;
  /** Where each subject ends. */
  to: PerSubject<I, V>;
  /**
   * How long a stretch takes, ms: a duration, unlike a glide's time constant. Asked per subject
   * each time one of its stretches starts.
   */
  ms: PerSubject<I, number>;
  /** The curve from `from` to `to`. Default `'ease'`, as CSS's. */
  ease?: Easing;
}

/**
 * The patch `spring` returns, a motion that can be retargeted.
 *
 * @category patch
 */
export interface Spring<I, O, V extends Value> extends Moving<I, O, V> {
  /**
   * Heads `subject` for `target` from voice time `at`, keeping its velocity. `at` is by default the
   * mix's latest frame, or for a subject no frame of its voice has met yet, or still inside its
   * stagger, its first read, after any change with a time due by then. A subject faded out of the
   * voice comes back at the latest frame too, however long it is before it is next read.
   */
  to(subject: I, target: V, at?: number): void;
}

/**
 * The patch `glide` returns, a motion that reports its bounds.
 *
 * @category patch
 */
export interface Glide<I, O, V extends Value> extends Moving<I, O, V> {
  /** `subject`'s bounds, undefined for a glide without them. */
  bounds(subject: I): readonly [min: V, max: V] | undefined;
}

/**
 * The patch `tween` returns, a motion that can be retargeted, with no {@link Moving.push | `push`}.
 *
 * @category patch
 */
export interface Tween<I, O, V extends Value> extends Omit<Moving<I, O, V>, 'push'> {
  /**
   * Heads `subject` for `target` from voice time `at`, over a full {@link TweenOptions.ms | `ms`} from where it is. `at` is
   * by default the mix's latest frame, or for a subject no frame of its voice has met yet, or still
   * inside its stagger, its first read, after any change with a time due by then. A subject faded
   * out of the voice comes back at the latest frame too, however long it is before it is next read.
   */
  to(subject: I, target: V, at?: number): void;
}
