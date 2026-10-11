import type { Fit, Order, Strength } from '../fit.js';
import type { Motion, Value } from '../motion.js';
import type { Described } from './history.js';
import type { Doubt } from './mix.js';
import type { Easing, Patch, Signal } from './patch.js';
import type { Hit, Placement } from './place.js';

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
 * How a voice or owner held by a span may give way so the span keeps its budget, which the span's
 * fit reads. Anything it does not allow, it will not do. Read only under a span.
 *
 * @category score
 */
export interface SpanHints {
  /** How many times faster than its own rate it may play. Default 1: no faster. */
  faster?: number;
  /** How many times slower than its own rate it may play. Default 1: no slower. */
  slower?: number;
  /** Whether it may start before the one before it ends, where the span's order would not. */
  overlap?: boolean;
  /** Whether it may jump to its end instead of playing. A span held by a span is never skipped. */
  ballast?: boolean;
  /** How hard its own length holds against the span's budget. Default `weak`. */
  priority?: Strength;
}

/**
 * What `cue` takes: a patch, and the clock, weight and reach it plays with.
 *
 * @category voice
 */
export interface VoiceSpec<I, O, H = unknown> extends SpanHints {
  patch: Patch<I, O, unknown, H>;
  /**
   * What `history.revive` rebuilds this spec from, so a history `store` can page the voice out once
   * it has left. A voice cued without it stays in memory for as long as history reaches it.
   */
  as?: Described;
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
export interface OwnerSpec<I, H = unknown> extends SpanHints {
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
 * What `span` takes: an owner with a budget, which lays out the voices it holds in an order and
 * fits them into the budget.
 *
 * @category score
 */
export interface SpanSpec<I, H = unknown> extends OwnerSpec<I, H> {
  /** Its budget, ms on its own clock. Default: none, so its children only keep their order. */
  duration?: number;
  /** How hard the budget holds against its children's own lengths. Default `strong`. */
  priority?: Strength;
  /** How its children are laid out, in the order they were cued. Default `queue`. */
  order?: Order;
  /** How far through the one before a child starts under `stagger`, 0..1. Default 0.5. */
  share?: number;
  /**
   * How the children are fitted once they are retimed toward the budget, faster or slower as
   * their hints allow. Default `pipe(condense(), shed())`.
   */
  fit?: Fit;
  /**
   * What happens where the fit leaves them too long for a span at least `strong`: `instant` jumps
   * every child weaker than the span to its end at once, and `overrun` lets them run long.
   * Default `instant`.
   */
  spill?: 'instant' | 'overrun';
}

/**
 * How a span's last fit came out.
 *
 * @category score
 */
export interface FitResult {
  /** Its budget, ms on its own clock; Infinity for none. */
  budget: number;
  /** Where its children end, ms on its own clock from its start. */
  length: number;
  /** How far `length` runs past the budget, 0 where it does not. */
  over: number;
  /** How many children it jumps to their end. */
  skipped: number;
  /** Whether the fit failed and `spill` decided. */
  fell: boolean;
}

/**
 * A span's handle: an owner's, and how its children were last fitted.
 *
 * @category score
 */
export interface SpanHandle<I = unknown> extends Handle<I> {
  readonly result: FitResult;
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
      /**
       * When the fade begins. A mix time: ahead, the voice plays untouched until then and begins
       * its fade exactly there, its `out` mark fixed from now, and `rise` before then takes it
       * back with nothing changed; at or behind now, the fade began then and is partway. `'rest'`:
       * leave per subject at the first frame that subject's contribution is at rest. Default now.
       */
      at?: number | 'rest';
      /** Ms after which the voice leaves whether or not it rested. */
      deadline?: number;
      subject?: never;
    }
  | {
      /**
       * The one subject to fade out of this voice, which plays on for the rest. Once the ramp ends
       * the voice forgets the subject and reaches it no more, until a motion patch's `to` or `push`
       * or the mix's `drop` brings it back, met afresh: `from`, `target` and `stagger` asked again.
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
  /** Live. A write shows at the next probe. */
  weight: number;
  /**
   * Playback rate now. Setting it changes speed at once; `ramp` eases into a new one. On a voice
   * still pending, a rate or a ramp applies from the voice's start, which stays where it is: at
   * rate 0 it starts on time and holds its first frame.
   */
  rate: number;
  /**
   * Moves the rate to `rate` linearly over `over` mix ms, so a pause or a slow-motion eases in
   * rather than snapping. The voice clock integrates the ramp, so its position stays continuous and
   * its speed does too. A later `rate` write or `ramp` replaces it; `seek` keeps it.
   */
  ramp(rate: number, over: number): void;
  /**
   * Moves this voice's clock, forward or back, and for an owner every clock it holds. By default
   * each subject's state (a patch's `state`, what `setting.keep` holds) is made fresh and stepped
   * again from the voice's start up to `elapsed` on its next probe; `state: 'keep'` leaves it where
   * it was. Answers how sure the state now is: `exact` for a voice with none, or rebuilt under
   * `stepMs` with no `maxDt`; `stepped` where it was caught up in one step or holds signal state;
   * `held` where it was kept, or depends on host fields or an input weight the rebuild cannot know.
   * A voice still pending starts on time, already at `elapsed`, and one that freezes before shows
   * that frame while it waits.
   */
  seek(elapsed: number, opts?: SeekOptions): Doubt;
  /**
   * Fades the voice out, or one subject out of it, as `FadeOptions` says. A voice already fading or
   * done is left as it is.
   */
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
  /**
   * Heads `subject` for `target`, for a voice playing a `spring` or a `tween`: the patch's own `to`,
   * reached without holding the patch. Throws for any other voice.
   */
  to(subject: I, target: Value, at?: number): void;
  /**
   * Sets `subject` moving at `velocity`, units per second, for a voice playing a `spring` or a
   * `glide`: the patch's own `push`. Throws for any other voice.
   */
  push(subject: I, velocity: Value, at?: number): void;
  /**
   * Where `subject` is and how fast it moves, for a voice playing a motion patch: the patch's own
   * `read`. Undefined for any other voice, and wherever the patch's `read` is.
   */
  read(subject: I, at?: number): Motion<Value> | undefined;
  /** Resolves when the voice has been removed from the mix, however that happened. */
  readonly done: Promise<void>;
  /**
   * Resolves true when a finite loop's last pass ends, for the latest-staggered subject it has
   * seen, and false if the voice leaves before that. Never rejects.
   */
  readonly played: Promise<boolean>;
}

/**
 * What `Handle.seek` does with each subject's state: `rebuild` (the default) makes it fresh and
 * steps it to the new position; `keep` leaves it as it was.
 *
 * @category voice
 */
export interface SeekOptions {
  state?: 'rebuild' | 'keep';
}
