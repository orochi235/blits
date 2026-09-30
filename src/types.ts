/**
 * One field of a delta, with its own arithmetic.
 *
 * @category channel
 */
export interface Channel<V> {
  /** Identity. Absent means the channel has none: it replaces rather than contributes. */
  rest?: V;
  /** Fold two influences into one. */
  merge(a: V, b: V): V;
  /** Fade toward `rest` by weight 0..1. Required when `rest` is set; absent otherwise. */
  scale?(v: V, w: number): V;
  /** Interpolate, for retargeting, for blending alternatives, and for folding a locus. */
  lerp(a: V, b: V, u: number): V;
  /**
   * Optional: `merge(into, scale(v, w))`, written into `into` and returned, so a channel whose
   * values are objects need not allocate per influence. The mix only hands it a value it made.
   */
  fold?(into: V, v: V, w: number): V;
}

/**
 * The channel set for one kind of delta.
 *
 * @category channel
 */
export type Kit<O> = { readonly [K in keyof O]-?: Channel<NonNullable<O[K]>> };

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
export interface Setting<S = void> {
  /**
   * The mix clock at this frame: the host's timestamp less any time `rebase` took out. Identical
   * for every probe in the frame.
   */
  timestamp: number;
  /**
   * The gap this subject is catching up by: milliseconds since it last advanced, which is the gap
   * since the previous sync only for a subject sampled every frame. Infinity under reduced motion;
   * no more than `maxDt` where the mix sets one.
   */
  dt: number;
  /** Milliseconds this voice has been playing, rate applied. */
  elapsed: number;
  /** Which pass this is, 0 first. */
  pass: number;
  /** This voice's weight for this subject this frame, after fades, signals and any locus. */
  weight: number;
  /** This subject's state, when the patch declares one. */
  state: S;
  /** Anything the host adds for its own patches. */
  host: unknown;
  /**
   * The state `owner` keeps for this voice and this subject, made by `init` on first ask. The mix
   * holds it, so a read at another time can copy it instead of moving it. A stateful signal keeps
   * its state here and nowhere else.
   */
  keep<K>(owner: object, init: () => K): K;
}

/**
 * A pure function of phase and a subject that returns a delta. Optionally stateful.
 *
 * @category patch
 */
export interface Patch<I, O, S = void> {
  /** Which authoring form built it. An engine declares which forms it runs. */
  readonly form: 'fn' | 'keys';
  /** Milliseconds one pass lasts. 0 is aperiodic: phase and pass stay 0. */
  readonly period: number;
  /** The channels this patch contributes to. Every key `at` sets, and no others. */
  readonly writes: readonly (keyof O)[];
  /** `phase` is 0..1 across one period, wrapping. */
  at(phase: number, subject: I, setting: Setting<S>): Partial<O>;
  /** Per-subject state, created on the first frame this patch sees a subject. */
  state?(subject: I): S;
  /** Advances state once per subject per sampled frame, by the whole gap since it last advanced. */
  step?(state: S, dt: number, subject: I, setting: Setting<S>): void;
  /** Present when the patch was authored as keyframes, so an engine that reads data can. */
  readonly keys?: readonly Keyframe<O>[];
}

/**
 * A 0..1 scalar resolved per subject per frame from something outside the clock. `input` is set
 * when it reads something the clock does not drive, such as a value the host writes; a signal
 * built on one inherits it.
 *
 * @category signal
 */
export type Signal<I> = ((subject: I, setting: Setting) => number) & { readonly input?: boolean };

/**
 * A voice's own ramps in and out, in ms, and the curve both take.
 *
 * @category blending
 */
export interface FadeSpec {
  in?: number;
  out?: number;
  ease?: Easing;
}

/**
 * What `cue` takes: a patch, and the clock, weight and reach it plays with.
 *
 * @category voice
 */
export interface VoiceSpec<I, O> {
  patch: Patch<I, O, unknown>;
  /**
   * Which subjects this voice reaches. Default: all of them. The predicate is fixed at `cue`; it
   * runs per subject the first time the mix sees that subject, and the answer is kept.
   */
  target?: (subject: I) => boolean;

  /**
   * When the voice starts, in ms on the host's clock, the one it passes `sync`: a rAF timestamp and
   * `performance.now()` share an origin, `Date.now()` does not. Default: the next sync.
   */
  start?: number;
  /** Playback rate. 1 is real time; 0 freezes. */
  rate?: number;
  /**
   * true loops for good, false plays one pass, n plays n passes. A finite loop leaves when its
   * passes are done — over `fade.out` where one is set, at once where none is.
   */
  loop?: boolean | number;
  /**
   * Per-subject delay in voice ms, klieg's stagger grammar reduced to the one thing the mix needs.
   * Like `target`, it runs once per subject on first sight, and the answer is kept.
   */
  stagger?: (subject: I) => number;

  /** Steady weight, or a signal read per subject per frame. Default 1. */
  weight?: number | Signal<I>;
  /** Ramp in and out, ms. Out applies on `fade()` and when a finite loop ends. */
  fade?: FadeSpec;
  /** Voices sharing a locus are alternatives: the mix folds them through each channel's `lerp`. */
  locus?: string;

  /** A `keys` voice whose first stop reads wherever this subject is now. */
  from?: 'current';
}

/**
 * How a voice leaves when it is faded.
 *
 * @category blending
 */
export interface FadeOptions {
  /** The ramp, ms. Defaults to the voice's own `fade.out`. */
  over?: number;
  /** Leave per subject at the first frame that subject's contribution is at rest. */
  at?: 'rest';
  /** Ms after which the voice leaves whether or not it rested. */
  deadline?: number;
}

/**
 * The live controls on one voice, returned by `cue`.
 *
 * @category voice
 */
export interface Handle {
  readonly id: number;
  readonly state: 'pending' | 'live' | 'fading' | 'done';
  /** Live. Writes land on the next sync. */
  weight: number;
  rate: number;
  /**
   * Moves this voice's clock, forward or back. Phase is computed from the reading rather than
   * accumulated into, so state is left where it is and never run forward to meet the new position.
   */
  seek(elapsed: number): void;
  fade(opts?: FadeOptions): void;
  /** Resolves when the voice has been removed from the mix, however that happened. */
  readonly done: Promise<void>;
}

/**
 * How a mix is built: its engine, reduced motion, the host, and its limits.
 *
 * @category mix
 */
export interface MixOptions {
  engine?: Engine;
  /** Reduced motion: fades and warm-ups snap, `dt` reads Infinity. */
  reduce?: boolean | (() => boolean);
  /** Merged into every `setting.host`. */
  host?: unknown;
  /**
   * The band a rest-less channel's influence switches on and off across. It has to clear the frame
   * noise in a real signal; these are placeholders until the klieg port measures one.
   */
  band?: { on: number; off: number };
  /**
   * The most `dt` a `step` or signal is handed, however long the gap. Off by default, since a
   * patch with a closed form wants the whole gap; an integrator wants this set.
   */
  maxDt?: number;
}

/**
 * The live voices over one kit, folded into one pose per subject per frame.
 *
 * @category mix
 */
export interface Mix<I, O> {
  /** Cues a voice. Throws when the engine cannot run the patch's form, or the kit lacks a channel. */
  cue(spec: VoiceSpec<I, O>): Handle;
  /** N voices whose weights split one signal, cued into one locus so they fold as alternatives. */
  blend(
    patches: readonly Patch<I, O, unknown>[],
    by: Signal<I>,
    spec?: Omit<VoiceSpec<I, O>, 'patch' | 'weight' | 'locus'>,
  ): Handle[];

  /** The host reports the clock, once a frame. Nothing advances at the call. */
  sync(timestamp: number): void;
  /**
   * The time between the last sync and the next one is not to count: a host calls it when a
   * hidden tab comes back. Every voice, fade and subject resumes where it was left.
   */
  rebase(): void;
  /** The merged pose for one subject at the synced frame. */
  probe(subject: I, out?: O): O;
  /** Every channel at rest for this subject this frame, so a host can skip the write. */
  atRest(subject: I): boolean;

  /** Anything still contributing, fading, or pending. */
  readonly live: boolean;
  /** Fades every voice out: over `over` when given, over each voice's own `fade.out` otherwise. */
  mute(opts?: { over?: number }): void;
  /** Forgets per-subject state. */
  drop(subject: I): void;
}

/**
 * The implementation behind a mix: which patch forms it runs, and how it makes one.
 *
 * @category engine
 */
export interface Engine {
  readonly name: string;
  /** Which patch forms this engine can run. A voice it cannot run is refused at `cue`, by name. */
  readonly runs: ReadonlySet<'fn' | 'keys'>;
  create<I, O>(kit: Kit<O>, opts: MixOptions): Mix<I, O>;
}
