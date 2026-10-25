import type { Curve } from './easing.js';
import type { Motions } from './motions.js';
import type { MotionSpec } from './types.js';

/**
 * One closed-form stretch: released at `at` (voice ms) from `x0` moving at `v0`, toward `to`, over
 * `ms` for a tween (0 for any other shape).
 */
export interface Segment {
  at: number;
  ms: number;
  x0: number[];
  v0: number[];
  to: number[];
  /** The change that released it; undefined for a subject's first stretch. */
  change?: Change;
}

export interface Change {
  /**
   * Voice ms it takes effect at; absent, until the subject's next read stamps it with that read's
   * time, for one made while no frame had met the subject.
   */
  at?: number;
  to?: number[];
  /** Where it moves from, in place of where its stretch has it then. */
  x?: number[];
  v?: number[];
  /** The mix clock when it was made, NaN where no mix was playing the patch. */
  made?: number;
  /** The frame it was made in, which a rewind partitions by; NaN where no mix was playing the patch. */
  seq?: number;
  /** Whether it was made before its frame was read, so a read of what that frame showed has it. */
  early?: boolean;
}

/** A record of a motion patch's history leaving memory, at a mix time and frame. */
export interface Paging {
  at: number;
  seq: number;
  data: unknown;
}

/** A subject's run as plain data: its flags, its stretches oldest first, and changes still to apply. */
export interface Run {
  flags: number;
  stretches: Segment[];
  pending: Change[] | undefined;
}

/** Where `numbers` gathers what it copies, kept an array of doubles so every copy is one too. */
const gathered = [0.5];

/** `n` numbers of `from` from `at`, as an array of their own. */
export function numbers(from: Float64Array, at: number, n: number): number[] {
  // `Array.from` walks a typed array by its iterator: about 500 B a call for three axes.
  for (let i = 0; i < n; i++) gathered[i] = from[at + i] as number;
  return gathered.slice(0, n);
}

/**
 * A subject's flags: its value is a number; it has changes pending; it has older stretches; the
 * stretch it is playing was found landed, which holds until another replaces it.
 */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
export const enum RunFlag {
  SCALAR = 1,
  PENDING = 2,
  OLDER = 4,
  LANDED = 8,
}

/**
 * The mix playing a patch, asked with its voice's id: an owner and an id, where a pair of closures
 * cost two functions, their contexts and a weak reference per voice.
 */
export interface MotionOwner {
  /** The subject's voice time at the mix's latest frame; NaN where no frame of the voice met it. */
  frame(id: number, subject: unknown): number;
  /**
   * Brings a subject the voice faded out back to it, so a change is not made for nothing: its
   * voice time now, which a change bringing it back is made at; NaN for any other subject.
   */
  revive(id: number, subject: unknown): number;
  /** The mix clock at its latest frame; NaN before the first. */
  now(): number;
  /** The number of the frame the mix is playing. */
  seq(): number;
  /** Whether a change made now comes before anything read the frame. */
  early(): boolean;
  /**
   * The host made a change, already given its time, which a seek makes again on the patch its
   * voice plays then: a voice a history store paged out comes back with a patch of its own.
   */
  changed<I>(id: number, motion: Motions<I>, subject: I, change: Change): void;
  /** History leaving memory for a subject, which a mix with a history store pages out. */
  page(id: number, stream: 'released' | 'stretch', subject: unknown, out: Paging[]): void;
}

/**
 * What a mix keeping copies of a patch's stretches is told, with its id and the subject's number,
 * before one changes.
 */
export interface Watcher {
  stretchChanged(id: number, s: number): void;
}

export interface Shape<I> {
  from: (subject: I) => number[];
  /** How fast each axis starts moving, given where it starts: still unless the options say. */
  velocity: (subject: I, x: number[]) => number[];
  /**
   * Where it heads when released from `x` at `v`, given where it was heading; `put` for a stretch a
   * `set` released.
   */
  aim: (x: number[], v: number[], was: number[] | null, subject: I, put: boolean) => number[];
  /** `[form, settle, k1, k2, k3]`. */
  law: readonly number[];
  /** Whether a subject's value is a number rather than an array. */
  scalar: (subject: I) => boolean;
  /** Whether every subject's value is a number; undefined where that depends on the subject. */
  scalarEvery(): boolean | undefined;
  /** A tween's easing, which its law cannot hold; undefined, but present, on every other shape. */
  ease: Curve | undefined;
  /** A tween's ms for a stretch the subject starts now; undefined, but present, on the rest. */
  ms: ((subject: I) => number) | undefined;
  /** The patch's kind and constants, as `Patch.motion` reports them. */
  spec(): MotionSpec;
}
