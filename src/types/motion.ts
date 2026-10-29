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
  /** Units per second. */
  velocity: V;
}

/**
 * A patch whose motion is a closed form per subject. It lands in the same place at any frame rate,
 * and its changes mid-flight start from where the subject is and how fast it moves.
 *
 * @category patch
 */
export interface Moving<I, O, V extends Value> extends Patch<I, O, void> {
  /**
   * Where `subject` is and how fast it moves at voice time `at`. `at` defaults to the mix's latest
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
   * Puts `subject` at `value` from voice time `at`, keeping its velocity. `at` defaults as `push`'s
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
  /** Per second squared. Default 170. */
  stiffness?: number;
  /** Per second. Default 26, just short of critical at the default stiffness. */
  damping?: number;
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
  /** The friction's time constant, ms. Default 325, a touch scroll's. */
  ms?: number;
  /** The least and greatest value a coast comes to rest at, per axis. Default none. */
  bounds?: PerSubject<I, readonly [min: V, max: V]>;
  /** The spring back's, per second squared, with `bounds`. Default 170, as a spring's. */
  stiffness?: number;
}

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
  /** How long a stretch takes, ms. Asked per subject each time one of its stretches starts. */
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
 * The patch `tween` returns, a motion that can be retargeted, with no `push`.
 *
 * @category patch
 */
export interface Tween<I, O, V extends Value> extends Omit<Moving<I, O, V>, 'push'> {
  /**
   * Heads `subject` for `target` from voice time `at`, over a full `ms` from where it is. `at` is
   * by default the mix's latest frame, or for a subject no frame of its voice has met yet, or still
   * inside its stagger, its first read, after any change with a time due by then. A subject faded
   * out of the voice comes back at the latest frame too, however long it is before it is next read.
   */
  to(subject: I, target: V, at?: number): void;
}
