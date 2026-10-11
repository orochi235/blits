import type { WaveOptions } from '../wave.js';
import type { Kit } from './channel.js';

/**
 * A curve on 0..1, as data where it can be: CSS's names, a `cubic-bezier`, or `steps`, which a
 * WAAPI or GPU engine can read. The function form runs on the CPU engine only.
 *
 * @category patch
 */
export type Easing =
  | ((u: number) => number)
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | { readonly bezier: readonly [x1: number, y1: number, x2: number, y2: number] }
  | { readonly steps: number; readonly jump?: 'start' | 'end' };

/**
 * One stop of a `keys` patch.
 *
 * @category patch
 */
export interface Keyframe<O> {
  /** Phase, 0..1. */
  at: number;
  delta: Partial<O>;
  ease?: Easing;
}

/**
 * What a patch may read and did not compute, for one subject this frame. The mix reuses the object,
 * so it is valid only during the call it is handed to.
 *
 * @category state
 */
export interface Setting<S = void, H = unknown> {
  /**
   * The mix clock at this frame: the host's timestamp less any time `rebase` took out, run at the
   * mix's `rate`. Identical for every probe in the frame.
   */
  timestamp: number;
  /**
   * The gap this subject is catching up by: milliseconds since it last advanced, which is the gap
   * since the previous sync only for a subject sampled every frame. Infinity under reduced motion;
   * no more than `maxDt` where the mix sets one. Inside a `step` under `stepMs`, it is `stepMs`, and
   * `timestamp` is the end of that interval. A lane samples a subject for one frame after its last
   * probe. A read by `project` is one sample, so its gap is not the gap a frame of play has.
   */
  dt: number;
  /**
   * Milliseconds this voice has been playing, rate applied. Below 0 only for a voice with no end
   * cued backward, which plays into the passes before its first.
   */
  elapsed: number;
  /** Which pass this is, 0 first; below 0 where `elapsed` is. */
  pass: number;
  /** This voice's weight for this subject this frame, after fades, signals and any locus. */
  weight: number;
  /** This subject's state, when the patch declares one. */
  state: S;
  /** Anything the host adds for its own patches: the mix's `host`, typed as its `H`. */
  host: H;
  /**
   * The state `owner` keeps for this voice and this subject, made by `init` on first ask. The mix
   * holds it, so a read at another time can copy it instead of moving it. A stateful signal keeps
   * its state here and nowhere else. With lanes on, a patch or weight signal that first calls it
   * partway through playing can have that state advanced once for one subject probed the frame
   * before it starts and not on that frame; one that keeps state from its first call, or a patch
   * that declares `state`, never does.
   */
  keep<K>(owner: object, init: () => K): K;
  /**
   * Reports an event at `timestamp`, for this voice and this subject. The mix queues it until the
   * host drains it, and never calls back. Meant for `step`, where under `stepMs` the timestamp is
   * the interval the event happened in rather than the frame that sampled it. Sent from a stateless
   * patch's `at` while it runs on a lane, it goes out for every subject the lane fills, probed that
   * frame or not: each probed that frame or the last; `at` is not asked for a subject at weight 0,
   * so nothing is sent from it there.
   */
  send(event: unknown): void;
}

/**
 * One event a patch sent, as `drain` hands it back.
 *
 * @category state
 */
export interface Sent<I, E = unknown> {
  /** The mix clock when it was sent. */
  timestamp: number;
  subject: I;
  /** The id of the voice whose patch sent it, as its handle reports. */
  voice: number;
  /** That voice's tags. */
  tags: readonly string[];
  event: E;
}

/**
 * What a `'motion'` patch is made of, as data an engine can read: the kind of motion and its
 * constants. Each subject's start, target and starting velocity stay on the patch, since they may
 * be functions of the subject.
 *
 * @category patch
 */
export type MotionSpec =
  | {
      readonly kind: 'spring';
      /** Per second squared. */
      readonly stiffness: number;
      /** Per second. */
      readonly damping: number;
      readonly mass: number;
      readonly settle: number;
    }
  | {
      readonly kind: 'glide';
      /** The friction's time constant, ms. */
      readonly ms: number;
      readonly settle: number;
    }
  | {
      readonly kind: 'tween';
      /** How long a stretch takes; undefined where it varies by subject, kept on the patch then. */
      readonly ms: number | undefined;
      readonly ease: Easing;
    };

/**
 * A pure function of phase and a subject that returns a delta. Optionally stateful.
 *
 * @category patch
 */
export interface Patch<I, O, S = void, H = unknown> {
  /**
   * Which authoring form built it: `'fn'` from `patch`, `'keys'` from `keys`, `'motion'` from
   * `spring`, `glide` or `tween`. An engine declares which forms it runs.
   */
  readonly form: 'fn' | 'keys' | 'motion';
  /** Milliseconds one pass lasts, whether or not the voice loops. 0 has no passes: phase and pass stay 0. */
  readonly duration: number;
  /** The channels this patch contributes to. Every key `at` sets, and no others. */
  readonly writes: readonly (keyof O)[];
  /**
   * The channels this patch was written against. `cue` refuses a mix whose channel of the same name
   * is of another kind, so a patch published in one package cannot fold by another's arithmetic.
   */
  readonly kit?: Partial<Kit<O>>;
  /** The fields of `setting.host` this patch reads. `cue` refuses a mix whose host lacks one. */
  readonly reads?: readonly string[];
  /**
   * `phase` is 0..1 across one pass, wrapping. Not asked for a subject its voice gives no weight, unless the voice is fading to rest;
   * `step` still runs. A `keys` patch's stops are not read there either, unless its voice is in a locus.
   */
  at(phase: number, subject: I, setting: Setting<S, H>): Partial<O>;
  /** Per-subject state, created on the first frame this patch sees a subject. */
  state?(subject: I): S;
  /**
   * Advances state once per subject per sampled frame, by the whole gap since it last advanced; or,
   * where the mix sets `stepMs`, once per whole interval of that length.
   */
  step?(state: S, dt: number, subject: I, setting: Setting<S, H>): void;
  /** Present when the patch was authored as keyframes, so an engine that reads data can. */
  readonly keys?: readonly Keyframe<O>[];
  /**
   * Present on a `keys` patch that was given them: what `keys` took besides its stops, each as
   * `KeysOptions` describes it. They are read off the patch, so a copy that changes one, as
   * `{ ...p, ease: 'linear' }` does, plays by its own.
   */
  readonly ease?: Easing;
  easeBy?(channel: keyof O): Easing | undefined;
  delayBy?(channel: keyof O): number;
  lerpBy?(channel: keyof O): ((a: never, b: never, u: number) => unknown) | undefined;
  /** Present on a `wave` patch: what `wave` took, which a copy may change as it may a `keys` field. */
  readonly wave?: WaveOptions<O>;
  /** Present on a `'motion'` patch: its kind and constants, for an engine that reads data. */
  readonly motion?: MotionSpec;
  /**
   * A copy of `state` that shares nothing with it, for a read at another time. Default
   * `structuredClone`, which is enough for plain data; a state holding a class instance or a
   * function needs its own.
   */
  clone?(state: S): S;
  /**
   * `state` as data that survives `structuredClone`, for a history `store` to keep; `unpack` makes
   * a state from it again. With a store, a patch with `state` or `step` needs both, or `cue`
   * refuses it.
   */
  pack?(state: S): unknown;
  unpack?(data: unknown): S;
}

/**
 * A 0..1 scalar resolved per subject per frame from something outside the clock. `input` is set
 * when it reads something the clock does not drive, such as a value the host writes; a signal
 * built on one inherits it.
 *
 * @category signal
 */
export type Signal<I, H = unknown> = ((subject: I, setting: Setting<void, H>) => number) & {
  readonly input?: boolean;
};
