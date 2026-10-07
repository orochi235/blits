/**
 * One field of a delta, with its own arithmetic.
 *
 * @category channel
 */
export interface Channel<V> {
  /**
   * Names this channel's arithmetic, so a patch written against one channel can be checked against
   * another of the same name. Two channels of one kind must fold identically; the stock ones set it,
   * as `'sum'` or `'vec(3, sum)'`. Absent, a channel matches only itself.
   */
  kind?: string;
  /**
   * The range a numeric value means anything in, such as 0..1 for an opacity. The mix clamps the
   * folded value to it, axis by axis for an array, so neither stacked voices nor a retarget that
   * carries speed can push it out; overshoot stops flat at the bound.
   */
  bounds?: readonly [min: number, max: number];
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
   * `timestamp` is the end of that interval.
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
  /** Anything the host adds for its own patches: the mix's `host`, typed as its `H`. */
  host: H;
  /**
   * The state `owner` keeps for this voice and this subject, made by `init` on first ask. The mix
   * holds it, so a read at another time can copy it instead of moving it. A stateful signal keeps
   * its state here and nowhere else. With lanes on, a patch or weight signal that first calls it
   * partway through playing can have that state advanced once for one subject not probed on the
   * frame it starts; one that keeps state from its first call, or a patch that declares `state`,
   * never does.
   */
  keep<K>(owner: object, init: () => K): K;
  /**
   * Reports an event at `timestamp`, for this voice and this subject. The mix queues it until the
   * host drains it, and never calls back. Meant for `step`, where under `stepMs` the timestamp is
   * the interval the event happened in rather than the frame that sampled it. Sent from a stateless
   * patch's `at` while it runs on a lane, it goes out for every subject the mix has met, probed that
   * frame or not; `at` is not asked for a subject at weight 0, so nothing is sent from it there.
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
  /** @deprecated Use `duration`. A patch that sets only `period` still plays. */
  readonly period?: number;
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
   * `step` still runs.
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
  /** Present on a `'motion'` patch: its kind and constants, for an engine that reads data. */
  readonly motion?: MotionSpec;
  /**
   * A copy of `state` that shares nothing with it, for a read at another time. Default
   * `structuredClone`, which is enough for plain data; a state holding a class instance or a
   * function needs its own.
   */
  clone?(state: S): S;
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
 * The four times a voice is known by on the mix clock: when its fade in begins (`start`), when it is
 * fully in (`in`), when its fade out begins (`out`), and when it is gone (`end`).
 *
 * @category score
 */
export type Mark = 'start' | 'in' | 'out' | 'end';

/**
 * Selects voices by what the plan knows of them, never by a channel's value, within the asking
 * voice's own score unless it names another. Where several match,
 * the resolver picks one: `last` cued (the default), `first` cued, `next` (the earliest whose mark
 * is still to come), `earliest` or `latest` by the mark's time.
 *
 * @category score
 */
export interface Query {
  /** The score to look in. Default: the asking voice's own. */
  score?: string;
  name?: string;
  tag?: string;
  /** A channel the voice's patch writes. */
  writes?: string;
  resolver?: 'last' | 'first' | 'next' | 'earliest' | 'latest';
}

/**
 * A time given by another voice: `mark` of the voice `of` selects, moved by `by` ms. `after` is
 * sugar for that voice's `end`, `with` for its `start`, and `before` for its start less `by`. A
 * string selects by name. `all` is the latest of its anchors, known once every one is; `any` the
 * earliest, known once one has passed or every one is known.
 *
 * @category score
 */
export type Anchor =
  | { of: string | Query; mark: Mark; by?: number }
  | { after: string | Query; by?: number }
  | { with: string | Query; by?: number }
  | { before: string | Query; by?: number }
  | { all: readonly Anchor[] }
  | { any: readonly Anchor[] };

/**
 * Where a voice sits on the mix clock: at most one of `start` and `in`, and at most one of `out`
 * and `end`, each a timestamp on the host's clock or an anchor to another voice. A voice whose
 * anchor has no answer yet waits pending; one whose anchored mark is already past starts partway
 * through, as playback does from the middle of a region.
 *
 * @category score
 */
export interface Placement {
  start?: number | Anchor;
  in?: number | Anchor;
  out?: number | Anchor;
  end?: number | Anchor;
}

/**
 * One mark as `marks` lists it: one of a voice's four, or one the host announced on a score, which
 * has a name and no voice.
 *
 * @category score
 */
export interface Marked {
  /** On the host's clock. */
  timestamp: number;
  /** Which of a voice's four this is; undefined for an announced mark. */
  mark: Mark | undefined;
  /** The voice it belongs to; undefined for an announced mark. */
  voice: number | undefined;
  score: string | undefined;
  name: string | undefined;
  tags: readonly string[];
}

/**
 * An event at a time on a voice's own clock, which `book` hands a host ahead of time. It plays once
 * per pass, for the voice and not per subject, so `stagger` does not spread it.
 *
 * @category score
 */
export interface Hit<E = unknown> {
  /** Voice ms into each pass: 0 up to the patch's `duration`, or any time at all for a patch with none. */
  at: number;
  event: E;
}

/**
 * One pass of one hit, as `book` takes it.
 *
 * @category score
 */
export interface BookedHit<E = unknown> {
  /** On the host's clock. */
  timestamp: number;
  voice: number;
  /** Which of the voice's `hits`, by index. */
  hit: number;
  /** Which pass, 0 first. */
  pass: number;
  event: E;
  score: string | undefined;
  name: string | undefined;
  tags: readonly string[];
}

/**
 * What `book` takes: an outside clock, how far ahead to book on it, and what to do with each item.
 *
 * @category score
 */
export interface BookOptions<E = unknown> {
  /**
   * The outside clock, in ms: `audio.currentTime * 1000`, `performance.now()`, or whatever the host
   * schedules against. Read once a sync. The mix maps its host time onto it by an offset that folds
   * in 5% of each frame's difference, and starts over from the clock's own reading on a jump past
   * 50 ms, such as a suspended context or a hidden tab.
   */
  clock: () => number;
  /** How far ahead to book, host ms. It has to cover the longest gap between two syncs. */
  ahead: number;
  /** How far past an item first seen late may be and still be taken, host ms. */
  late: number;
  /**
   * Called once per item: a mark as `marks` lists it, or a hit. `when` is on the outside clock;
   * `lateBy` is how many host ms past the item was when first seen, 0 for one booked ahead, which
   * is then taken at the clock's now. Return a `stop` to hear about a booking whose time moved by
   * more than 1 ms or that went away (a seek, a rate or ramp on the voice or the mix, a fade, a
   * `rebase`, an anchor's target moving, the voice leaving); the item is then booked again, at its
   * new time, at the same sync.
   */
  take(item: Marked | BookedHit<E>, when: number, lateBy: number): { stop(): void } | undefined;
  /** Book only the voices, and announced marks, carrying this tag. */
  tag?: string;
  /** Book only this score's voices and marks. */
  score?: string;
}

/**
 * A running booker, returned by `book`.
 *
 * @category score
 */
export interface Booker {
  /** Stops every booking still ahead, and books nothing more. */
  stop(): void;
}

/**
 * What `cue` takes: a patch, and the clock, weight and reach it plays with.
 *
 * @category voice
 */
export interface VoiceSpec<I, O, H = unknown> {
  patch: Patch<I, O, unknown, H>;
  /**
   * Which subjects this voice reaches. Default: all of them. The predicate is fixed at `cue`; it
   * runs per subject the first time the mix sees that subject, and the answer is kept. Every
   * voice's predicate meets every subject, so voices that each reach a known few cost the square
   * of their number in time; name those with `subjects` instead. A no is kept as a bit by the
   * number lanes give the subject, but with `lanes: false` as a map entry per voice per subject
   * asked (about 37 MB for 1,000 such voices over 1,000 subjects).
   */
  target?: (subject: I) => boolean;
  /**
   * The subjects this voice reaches, fixed at `cue` and matched by identity; a probe of any other
   * never asks this voice. Takes the place of `target`, and a cue giving both is refused: a
   * predicate over a fixed list is that list filtered, which the host can do before cueing.
   */
  subjects?: readonly I[];

  /**
   * When the voice starts, in ms on the host's clock, the one it passes `sync`: a rAF timestamp and
   * `performance.now()` share an origin, `Date.now()` does not. Default: the next sync.
   */
  start?: number;
  /** Playback rate. 1 is real time; 0 freezes. */
  rate?: number;
  /**
   * true loops for good, false plays one pass, n plays n passes. A finite loop leaves when its
   * passes are done for the latest-staggered subject it has seen — over `fade.out` where one is
   * set, at once where none is — unless it freezes after.
   */
  loop?: boolean | number;
  /**
   * Per-subject delay in voice ms, klieg's stagger grammar reduced to the one thing the mix needs.
   * Like `target`, it runs once per subject on first sight, and the answer is kept.
   */
  stagger?: (subject: I) => number;
  /**
   * Show a subject the first frame before it starts — while the voice is pending and while the
   * subject waits out its `stagger` — the last frame of the last pass after a finite loop plays
   * out, or both. A frozen subject's clock stands still: `at` is asked for the edge frame and `step`
   * does not run, past one last step to the end of the last pass. `fade.in` counts from the first
   * frame the voice shows. A voice freezing after stays, `frozen`, until `fade()` or an anchored
   * `out` takes it out, so every one cued must be faded or it stays in the mix for good. Does
   * nothing to a motion patch, which keeps its target already. Default: neither.
   */
  freeze?: 'before' | 'after' | 'both';
  /** @deprecated Use `freeze`. A voice that sets only `hold` still freezes; `freeze` wins over it. */
  hold?: 'before' | 'after' | 'both';

  /** Steady weight, or a signal read per subject per frame. Default 1. */
  weight?: number | Signal<I, H>;
  /** Ramp in and out, ms. Out applies on `fade()` and when a finite loop ends. */
  fade?: FadeSpec;
  /** Voices sharing a locus are alternatives: the mix folds them through each channel's `lerp`. */
  locus?: string;

  /** A `keys` voice whose first stop reads wherever this subject is now. */
  from?: 'current';
  /** Words a source attaches to this voice, so its events and its handle can be taken as a set. */
  tags?: readonly string[];
  /** What other voices call this one by. A label blits never reads. */
  name?: string;
  /**
   * The plan this voice belongs to. Each source keeps its own, so two sources can use one name
   * without meeting: a bare name in an anchor means a voice in the same score, and a query names
   * `score` to reach into another. Default: the mix's one unnamed score.
   */
  score?: string;
  /** Where it sits relative to the clock or to other voices, in place of `start`. */
  anchor?: Placement;
  /**
   * Events at times on this voice's clock, which `book` hands a host ahead of time. Patch-sent
   * events are not known ahead, so they stay drain-only; these are the plan.
   */
  hits?: readonly Hit[];
  /**
   * The owner this voice plays under, a handle `owns` returned. Its `start` and `anchor` are then on
   * the owner's clock, in ms from when the owner starts, and default to where that clock is now; a
   * bare name in an anchor means a sibling, another voice the owner holds. Its clock runs on the
   * owner's, so the owner's rate, ramp and seeks move it, and its weight is multiplied by the
   * owner's weight and fade. Without a `freeze` of its own it takes the owner's.
   */
  owner?: Handle<I>;
}

/**
 * What `owns` takes: an owner has no patch, and plays only through the voices it holds.
 *
 * @category voice
 */
export interface OwnerSpec<I, H = unknown> {
  /**
   * When the owner starts, on its own owner's clock: the host's for an owner on the mix, as a
   * voice's `start` is. Default: now.
   */
  start?: number;
  /** Its clock's rate, multiplied into every child's own. Default 1. */
  rate?: number;
  /**
   * Multiplied into every child's weight per subject, as the child's own fade is, before the child's
   * locus folds it: a number, or a signal read per subject per frame. Default 1.
   */
  weight?: number | Signal<I, H>;
  /** One ramp in and out over every child, multiplied into their weights as `weight` is. */
  fade?: FadeSpec;
  /** The freeze every child without one of its own takes. */
  freeze?: 'before' | 'after' | 'both';
  /** @deprecated Use `freeze`. An owner that sets only `hold` still freezes; `freeze` wins over it. */
  hold?: 'before' | 'after' | 'both';
  /** Words a source attaches to it, as a voice's. */
  tags?: readonly string[];
  /** What other voices call it by, among its siblings. */
  name?: string;
  /** The plan it belongs to, as a voice's. */
  score?: string;
  /** Where it sits relative to its own owner's clock or to other voices, in place of `start`. */
  anchor?: Placement;
  /** The owner it plays under, so owners nest. */
  owner?: Handle<I>;
}

/**
 * How a voice leaves when it is faded: the whole voice, or one subject.
 *
 * @category blending
 */
export type FadeOptions<I = unknown> =
  | {
      /** The ramp, ms. Defaults to the voice's own `fade.out`. */
      over?: number;
      /** Leave per subject at the first frame that subject's contribution is at rest. */
      at?: 'rest';
      /** Ms after which the voice leaves whether or not it rested. */
      deadline?: number;
      subject?: never;
    }
  | {
      /**
       * The one subject to fade out of this voice, which plays on for the rest. Once the ramp ends
       * the voice forgets the subject and reaches it no more, until a motion patch's `to` brings it
       * back, met afresh: `from`, `target` and `stagger` asked again.
       */
      subject: I;
      /** The ramp, ms. Defaults to the voice's own `fade.out`; 0 takes the subject out at once. */
      over?: number;
    };

/**
 * The live controls on one voice, returned by `cue`.
 *
 * @category voice
 */
export interface Handle<I = unknown> {
  readonly id: number;
  /** `frozen`: a voice freezing after has played every pass and shows its last frame until faded. */
  readonly state: 'pending' | 'live' | 'frozen' | 'fading' | 'done';
  /** The handle of the owner this voice plays under; undefined for one on the mix clock. */
  readonly owner: Handle<I> | undefined;
  /** Live. Writes land on the next sync. */
  weight: number;
  /** Playback rate now. Setting it changes speed at once; `ramp` eases into a new one. */
  rate: number;
  /**
   * Moves the rate to `rate` linearly over `over` mix ms, so a pause or a slow-motion eases in
   * rather than snapping. The voice clock integrates the ramp, so its position stays continuous and
   * its speed does too. A later `rate` write or `ramp` replaces it; `seek` keeps it.
   */
  ramp(rate: number, over: number): void;
  /**
   * Moves this voice's clock, forward or back. Phase is computed from the reading rather than
   * accumulated into, so state is left where it is and never run forward to meet the new position.
   */
  seek(elapsed: number): void;
  fade(opts?: FadeOptions<I>): void;
  /**
   * Turns a fade out around: the voice climbs back from where its fade had got to, up the same
   * curve, over `over` ms for the whole curve (default its `fade.in`, else its `fade.out`), and
   * plays on as if never faded. A fade waiting for rest is taken back at once; a voice not fading
   * is left as it is. A voice whose own end began the fade starts it again at its next frame.
   */
  rise(opts?: { over?: number }): void;
  /**
   * The weight this voice gave `subject` the last frame that subject was probed: after its fades
   * and its weight signal, before a locus folds it with its alternatives. 0 for a subject it does
   * not reach, has not started on and does not freeze before, has left at rest, or has never been
   * probed for; 0 once done.
   * Costs nothing until it is asked.
   */
  weightOf(subject: I): number;
  /** Resolves when the voice has been removed from the mix, however that happened. */
  readonly done: Promise<void>;
  /**
   * Resolves true when a finite loop's last pass ends, for the latest-staggered subject it has
   * seen, and false if the voice leaves before that. Never rejects.
   */
  readonly played: Promise<boolean>;
}

/**
 * How a mix is built: its engine, reduced motion, the host, and its limits.
 *
 * @category mix
 */
export interface MixOptions<H = unknown> {
  engine?: Engine;
  /** Reduced motion: fades and warm-ups snap, `dt` reads Infinity. */
  reduce?: boolean | (() => boolean);
  /** Merged into every `setting.host`. Its type is the mix's `H`, which every patch and signal it cues reads. */
  host?: H;
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
  /**
   * Run every `step` at this fixed interval, ms, instead of once by the frame's gap, so stateful
   * patches play the same at any frame rate. Intervals count from when a subject's delay ran out,
   * the remainder carrying to the next sample; `maxDt` then caps how many one sample may run.
   * Signals and `at` still see the frame. Off by default.
   */
  stepMs?: number;
  /**
   * How far back `project` may read, in ms of mix time, and how often a stateful voice's state is
   * kept per subject on the way, `every` ms (default 200). Within it the mix remembers what it cued,
   * every change a handle made and when, the voices that have left, and those copies of state, so a
   * read back restores the nearest copy and steps forward from it. Off by default, and a mix without
   * it keeps nothing. With `inputs`, it also keeps what each input signal on a voice's weight read
   * per subject, and the host fields patches `reads`, each time they changed, so a read back over a
   * `level` or a pointer is known rather than held. With `tape`, the mix also records every call
   * the host makes on it, its handles and its motion patches, so `seek` can move it and play those
   * calls again.
   */
  history?: { ms: number; every?: number; inputs?: boolean; tape?: TapeMaker };
  /**
   * Whether a channel may run as a lane: computed for every subject at once in flat arrays, when
   * every voice writing it can run that way. On by default; the pose is the same either way, so
   * turning it off is for ruling a lane out, or for comparing against. Two things differ: a
   * stateless patch's `setting.send` from `at` sends for every subject a lane fills, probed or not,
   * and a patch that first calls `setting.keep` partway through playing can advance that state once
   * more for one unprobed subject (see `Setting.keep`).
   */
  lanes?: boolean;
}

/**
 * One host call a mix recorded on its tape: `apply` makes it again, and `invert` does nothing,
 * since a mix goes back by restoring what it kept rather than by undoing calls.
 *
 * @category mix
 */
export interface TapeOp {
  apply(adapter: unknown): void;
  invert(): TapeOp;
  label?: string;
}

/**
 * One future a tape keeps at its current entry: the calls the host made after the mix last went
 * back here, before it made new ones.
 *
 * @category mix
 */
export interface TapeBranch {
  /** Its first entry's id, which `switchBranch` takes. */
  id: number;
  label: string;
  timestamp: number;
  /** How many entries run along it from here. */
  length: number;
  /** Whether the mix plays it on from here. */
  current: boolean;
}

/**
 * Where a mix keeps the host's calls, by mix time, for `seek`. weasel-history's `History`
 * (`@weasel-js/history`) has this shape. A host reads `branches` and calls `switchBranch` to pick
 * which recorded future plays on; moving it any other way is the mix's job.
 *
 * @category mix
 */
export interface Tape {
  recordEntry(ops: TapeOp[], label: string): void;
  undoDepth(): number;
  timestampAt(i: number): number | undefined;
  depthAt(t: number): number;
  goto(n: number): void;
  redo(): void;
  prune(t: number): void;
  branches(): readonly TapeBranch[];
  switchBranch(id: number): void;
}

/**
 * Makes a mix's tape: weasel-history's `createHistory` is one. The mix passes the clock it stamps
 * calls with, branching on, so a call made after going back keeps the old future as a branch, and
 * coalescing off.
 *
 * @category mix
 */
export type TapeMaker = (
  adapter: unknown,
  opts: { now: () => number; branching: boolean; coalesceWindowMs: number },
) => Tape;

/**
 * How sure a projection is of one channel: `exact` where only the clock and known changes drove
 * it; `stepped` where state was advanced across a gap in one go, which is as good as the patch's
 * step makes it; `held` where it depends on input from outside the clock, whose value at that time
 * is not known, so the value it had is held.
 *
 * @category mix
 */
export type Doubt = 'exact' | 'stepped' | 'held';

/**
 * The mix read at another time: what `probe` would give at that timestamp, with nothing in the
 * live mix moved. Valid until the mix is next synced or cued.
 *
 * @category mix
 */
export interface Projection<I, O> {
  /** The mix time it reads at. */
  readonly timestamp: number;
  /** The merged pose for one subject at this projection's timestamp. */
  probe(subject: I, out?: O): O;
  /** Per channel, how sure that pose is; the least sure voice that fed a channel decides. */
  assess(subject: I): { [K in keyof O]-?: Doubt };
}

/**
 * Arrays for `pull` to write, one per channel it reads: any channel whose value is a number or an
 * array of numbers.
 *
 * @category mix
 */
export type Columns<O> = {
  [K in keyof O as NonNullable<O[K]> extends number | readonly number[] ? K : never]?: Float64Array;
};

/**
 * The live voices over one kit, folded into one pose per subject per frame.
 *
 * @category mix
 */
export interface Mix<I, O, H = unknown> {
  /** Cues a voice. Throws when the engine cannot run the patch's form, or the kit lacks a channel. */
  cue(spec: VoiceSpec<I, O, H>): Handle<I>;
  /**
   * N voices whose weights split one signal, cued into one locus so they fold as alternatives. The
   * signal is read once per subject per frame, with the first member's setting, and every member
   * takes its share of that one reading; a signal keeping state keeps it once, not per member.
   */
  blend(
    patches: readonly Patch<I, O, unknown, H>[],
    by: Signal<I, H>,
    spec?: Omit<VoiceSpec<I, O, H>, 'patch' | 'weight' | 'locus'>,
  ): Handle<I>[];

  /**
   * Cues an owner: a voice with no patch that holds the voices cued with `owner` set to its handle,
   * and plays them on its own clock, so they can be placed, timed and faded as one. Its handle acts
   * on all of them: `rate` and `ramp` multiply into theirs, `seek` moves their clocks with its own
   * and leaves their state where it is, and `weight` and `fade()` multiply into their weights, by
   * what its `weightOf` reports; it fades as a whole, not by subject or at rest. It is
   * `played` once every voice it held has finished its passes, and leaves, `done`, with its last; a
   * fade that ends takes the rest with it. One that never holds a voice stays until faded. Owners
   * nest. Throws for a `loop`: a pass would have to restart its children.
   */
  owns(spec: OwnerSpec<I, H>): Handle<I>;

  /**
   * The host reports the clock, once a frame. Nothing advances at the call. Throws for a timestamp
   * earlier than the last sync's, short of a `rebase`: the host's clock only goes forward, and
   * `seek` moves the mix.
   */
  sync(timestamp: number): void;
  /**
   * The time between the last sync and the next one is not to count: a host calls it when a
   * hidden tab comes back. Every voice, fade and subject resumes where it was left.
   */
  rebase(): void;
  /**
   * The mix's own playback rate, multiplied into every voice's: 1 is real time and 0 pauses the
   * whole mix. A negative rate throws: the mix plays only forward, and `seek` moves it back. Setting it changes speed at
   * once; `ramp` eases into a new one. It scales mix time, which everything a voice owns runs on:
   * its clock, its fades and a handle's ramp, `stagger`, an anchor's `by`, `stepMs`, `maxDt`,
   * `history.ms`, every `dt`, and `setting.timestamp`. Timestamps on the host's clock name the same
   * moment whatever the rate does: a `start`, an anchor given as a number, an announced mark, what
   * `marks` reports and the time `project` reads, so a start ahead of a paused mix waits for the
   * host's clock to reach it. A weight signal is still asked at every probe, so one reading host
   * input follows it while the mix is paused.
   */
  rate: number;
  /**
   * Moves the mix's rate to `rate` linearly over `over` ms of the host's clock, as `Handle.ramp`
   * moves a voice's. Mix time integrates the ramp and a voice's clock integrates mix time, so a ramp
   * on both multiplies and every position stays continuous. A later `rate` write or `ramp` replaces
   * it.
   */
  ramp(rate: number, over: number): void;
  /**
   * The merged pose for one subject at the synced frame, written into `out` when given. Without
   * it, each call makes a new object, so a host reading every subject every frame passes `out` or
   * reads by `pull`.
   */
  probe(subject: I, out?: O): O;
  /**
   * Writes each subject's pose into arrays, one per channel, subject by subject in the order given:
   * what `probe(subject, out)` gives, without a pose object per subject. A channel of `n` numbers
   * takes `n` places per subject, side by side; one with no value for a subject writes NaN there.
   * Fastest while every voice runs on a lane, and when `subjects` is an array read again in the
   * same order: the mix remembers the last array's subjects by position, holding them until the
   * next `pull`, and skips looking up any still in its place. Throws when an array is too short for
   * the subjects.
   */
  pull(subjects: Iterable<I>, into: Columns<O>): void;
  /**
   * Reads the mix at another mix time, without moving it. Ahead of the mix it plays what is cued
   * forward, not what a tape recorded after a `seek` back; behind it, it needs `history`, and
   * throws for a time older than the history reaches.
   */
  project(time: number): Projection<I, O>;
  /**
   * Moves the mix to mix time `time`, as it stood at the end of that frame, and plays on from
   * there. Needs `history` with a `tape`, which records the host's calls by mix time.
   *
   * Back, the mix restores itself: controls, records, voices and marks as they stood then. Voices
   * that left after it are back on the handles the host holds, their `done` and `played` starting
   * over where they had settled since. Voices cued after it wait as `pending` until the mix plays
   * their cue again. Stateful voices restart from the copy `history` kept nearest before it and
   * step once to it, exact under `stepMs`. A subject faded out of a voice or dropped after it comes
   * back as never seen, and `from: 'current'` voices take their pose afresh. Recorded input and
   * host fields after it are let go: after a seek back, signals and host fields read live again.
   *
   * Forward, through a sync or a later seek, the mix plays the recorded calls again at the mix
   * times they were made: cues, handle writes, fades, retargets and pushes, its rate, marks,
   * `mute` and `drop`. A call the host makes while there are recorded calls ahead starts a new
   * branch, and the tape keeps the old future beside it; `tape.switchBranch` picks one back.
   * Playing past a time again sends its events and books its marks and hits again.
   *
   * The host goes on passing its own clock: the next `sync` reads the moment sought plus the
   * host's time since its last sync. Throws for a time older than history reaches, and before
   * the first sync.
   */
  seek(time: number): void;
  /**
   * The mix clock at the last sync or seek, which `seek` and `project` take; NaN before the first
   * sync. Host time at the mix's rate, less what `rebase` took out and `seek` moved.
   */
  readonly now: number;
  /** The tape `history.tape` made, undefined without one. */
  readonly tape: Tape | undefined;
  /**
   * Every channel at rest for this subject this frame, so a host can skip the write. After a probe
   * of the subject this frame, it answers for the pose that probe gave, without folding again.
   */
  atRest(subject: I): boolean;

  /**
   * A handle on every voice still in the mix, pending, live, frozen or fading, in the order they were
   * cued; given a tag, only the voices whose `tags` carry it. Each is the handle `cue` returned for
   * that voice, so a listed handle is `===` the cued one.
   */
  voices(tag?: string): Handle<I>[];
  /** Anything still contributing, fading, or pending. */
  readonly live: boolean;
  /**
   * Another frame would change no pose, so a host's frame loop may sleep: every voice is done, frozen
   * at a plain weight, or a motion whose every subject has landed on its target. At rate 0 it is
   * enough that every voice not done has started, at a plain weight, with no anchor. A change made
   * since the last sync, a retarget or a rate included, makes it false until the next.
   */
  readonly inert: boolean;
  /**
   * Calls `fn` when a host call makes the mix need frames again after a sync: a cue, a fade, a
   * handle's or the mix's rate, a seek, a `drop`, a motion retargeted. It fires once until the next
   * sync clears the change, and never during `sync`. Returns a function that unsubscribes `fn`.
   * A frame loop sleeping on `inert` subscribes here to wake.
   */
  onWake(fn: () => void): () => void;
  /** Fades every voice out: over `over` when given, over each voice's own `fade.out` otherwise. */
  mute(opts?: { over?: number }): void;
  /** Forgets per-subject state, a motion patch's for the subject included. */
  drop(subject: I): void;
  /**
   * Puts a named mark on a score, for anchors to target as they target a voice's marks: a voice
   * placed `{ with: 'reply' }` waits until the host announces `reply`. `at` is a timestamp on the
   * host's clock, default now, and may lie ahead, so a read ahead sees it. A mark stays while it is
   * ahead or while the mix's history reaches it.
   */
  announce(name: string, opts?: { at?: number; score?: string; tags?: readonly string[] }): void;
  /**
   * Every mark the plan knows between two timestamps on the host's clock, earliest first: when
   * voices start, are fully in, begin to fade and are gone, and what the host announced. A mark
   * nothing has fixed yet, such as the out of a voice that loops for good, is not listed.
   */
  marks(from: number, to: number): Marked[];
  /**
   * Every event patches have sent since the last drain, earliest first, in the order they were sent
   * where two share a timestamp. A subject's events are made while it catches up, which is when it is
   * probed, so one nobody probes has sent nothing yet: promptness is the host's, by probing. A
   * stateless patch's `at` on a lane is the exception: it runs for every subject the mix has met, at
   * the frame's first probe. Under `stepMs` each carries the end of the interval it happened in, so
   * what is sent and when does not depend on how the host spaces its probes. Time `rebase` took out
   * sends nothing. Given a tag, it takes only the events of voices carrying it and leaves the rest for
   * whoever drains them.
   */
  drain<E = unknown>(tag?: string): Sent<I, E>[];
  /**
   * Hands the host each mark and hit before it comes, against a clock of its own, so it can schedule
   * the thing itself: a sound on an `AudioContext`, a MIDI message with a timestamp, a video loaded
   * before the voice that shows it starts. Booking runs at each `sync`, `ahead` ms out, and a
   * booking whose time moves is stopped and taken again. Nothing is booked twice: a mark is known by
   * its voice and which mark, a hit by its voice, index and pass. `project` books nothing, and
   * nothing about booking is replayed under `history`. A mix with no booker pays nothing for it.
   */
  book<E = unknown>(opts: BookOptions<E>): Booker;
}

/**
 * The implementation behind a mix: which patch forms it runs, and how it makes one.
 *
 * @category engine
 */
export interface Engine {
  readonly name: string;
  /** Which patch forms this engine can run. A voice it cannot run is refused at `cue`, by name. */
  readonly runs: ReadonlySet<'fn' | 'keys' | 'motion'>;
  create<I, O, H = unknown>(kit: Kit<O>, opts: MixOptions<H>): Mix<I, O, H>;
}
