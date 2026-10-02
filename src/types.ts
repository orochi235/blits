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
export interface Setting<S = void> {
  /**
   * The mix clock at this frame: the host's timestamp less any time `rebase` took out. Identical
   * for every probe in the frame.
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
  /** Anything the host adds for its own patches. */
  host: unknown;
  /**
   * The state `owner` keeps for this voice and this subject, made by `init` on first ask. The mix
   * holds it, so a read at another time can copy it instead of moving it. A stateful signal keeps
   * its state here and nowhere else.
   */
  keep<K>(owner: object, init: () => K): K;
  /**
   * Reports an event at `timestamp`, for this voice and this subject. The mix queues it until the
   * host drains it, and never calls back. Meant for `step`, where under `stepMs` the timestamp is
   * the interval the event happened in rather than the frame that sampled it.
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
  /**
   * The channels this patch was written against. `cue` refuses a mix whose channel of the same name
   * is of another kind, so a patch published in one package cannot fold by another's arithmetic.
   */
  readonly kit?: Partial<Kit<O>>;
  /** The fields of `setting.host` this patch reads. `cue` refuses a mix whose host lacks one. */
  readonly reads?: readonly string[];
  /** `phase` is 0..1 across one period, wrapping. */
  at(phase: number, subject: I, setting: Setting<S>): Partial<O>;
  /** Per-subject state, created on the first frame this patch sees a subject. */
  state?(subject: I): S;
  /**
   * Advances state once per subject per sampled frame, by the whole gap since it last advanced; or,
   * where the mix sets `stepMs`, once per whole interval of that length.
   */
  step?(state: S, dt: number, subject: I, setting: Setting<S>): void;
  /** Present when the patch was authored as keyframes, so an engine that reads data can. */
  readonly keys?: readonly Keyframe<O>[];
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
 * string selects by name.
 *
 * @category score
 */
export type Anchor =
  | { of: string | Query; mark: Mark; by?: number }
  | { after: string | Query; by?: number }
  | { with: string | Query; by?: number }
  | { before: string | Query; by?: number };

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
 * What `cue` takes: a patch, and the clock, weight and reach it plays with.
 *
 * @category voice
 */
export interface VoiceSpec<I, O> {
  patch: Patch<I, O, unknown>;
  /**
   * Which subjects this voice reaches. Default: all of them. The predicate is fixed at `cue`; it
   * runs per subject the first time the mix sees that subject, and the answer is kept. Every
   * voice's predicate meets every subject, so voices that each reach a known few cost the square
   * of their number; name those with `subjects` instead.
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
   * set, at once where none is.
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
  /** Words a source attaches to this voice, so its events can be drained as a set. */
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
export interface Handle<I = unknown> {
  readonly id: number;
  readonly state: 'pending' | 'live' | 'fading' | 'done';
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
  fade(opts?: FadeOptions): void;
  /**
   * The weight this voice gave `subject` the last frame that subject was probed: after its fades
   * and its weight signal, before a locus folds it with its alternatives. 0 for a subject it does
   * not reach, has not started on, has left at rest, or has never been probed for; 0 once done.
   * Costs nothing until it is asked.
   */
  weightOf(subject: I): number;
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
   * `level` or a pointer is known rather than held.
   */
  history?: { ms: number; every?: number; inputs?: boolean };
}

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
  /** The timestamp it reads at, on the host's clock. */
  readonly timestamp: number;
  /** The merged pose for one subject at this projection's timestamp. */
  probe(subject: I, out?: O): O;
  /** Per channel, how sure that pose is; the least sure voice that fed a channel decides. */
  assess(subject: I): { [K in keyof O]-?: Doubt };
}

/**
 * The live voices over one kit, folded into one pose per subject per frame.
 *
 * @category mix
 */
export interface Mix<I, O> {
  /** Cues a voice. Throws when the engine cannot run the patch's form, or the kit lacks a channel. */
  cue(spec: VoiceSpec<I, O>): Handle<I>;
  /** N voices whose weights split one signal, cued into one locus so they fold as alternatives. */
  blend(
    patches: readonly Patch<I, O, unknown>[],
    by: Signal<I>,
    spec?: Omit<VoiceSpec<I, O>, 'patch' | 'weight' | 'locus'>,
  ): Handle<I>[];

  /** The host reports the clock, once a frame. Nothing advances at the call. */
  sync(timestamp: number): void;
  /**
   * The time between the last sync and the next one is not to count: a host calls it when a
   * hidden tab comes back. Every voice, fade and subject resumes where it was left.
   */
  rebase(): void;
  /** The merged pose for one subject at the synced frame. */
  probe(subject: I, out?: O): O;
  /**
   * Reads the mix at another timestamp, on the host's clock, without moving it. Ahead of the last
   * sync it plays what is cued forward; behind it, it needs `history`, and throws for a timestamp
   * older than the history reaches.
   */
  project(timestamp: number): Projection<I, O>;
  /** Every channel at rest for this subject this frame, so a host can skip the write. */
  atRest(subject: I): boolean;

  /** Anything still contributing, fading, or pending. */
  readonly live: boolean;
  /** Fades every voice out: over `over` when given, over each voice's own `fade.out` otherwise. */
  mute(opts?: { over?: number }): void;
  /** Forgets per-subject state. */
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
   * probed, so one nobody probes has sent nothing yet: promptness is the host's, by probing. Under
   * `stepMs` each carries the end of the interval it happened in, so what is sent and when does not
   * depend on how the host spaces its probes. Time `rebase` took out sends nothing. Given a tag, it
   * takes only the events of voices carrying it and leaves the rest for whoever drains them.
   */
  drain<E = unknown>(tag?: string): Sent<I, E>[];
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
