import type { Fit, Order, Strength } from '../fit.js';
import type { Described } from './history.js';
import type { Doubt } from './mix.js';
import type { Motion, Value } from './motion.js';
import type { Easing, Patch, Signal } from './patch.js';
import type { Anchor, Hit, Placement } from './place.js';

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
 * How a span's child may give way so the span keeps its budget. A child is a voice or owner
 * held by a span, and the span's fit reads this. Anything it does not allow, it will not do. Read only under a span.
 *
 * @category score
 */
export interface SpanHints {
  /** How many times faster than its own rate it may play. Default 1, no faster. */
  faster?: number;
  /** How many times slower than its own rate it may play. Default 1, no slower. */
  slower?: number;
  /** Whether it may start before the one before it ends, even where the span's order would not. */
  overlap?: boolean;
  /** Whether it may jump to its end instead of playing. A span held by a span is never skipped. */
  ballast?: boolean;
  /** How hard its own length holds against the span's budget. Default `weak`. */
  priority?: Strength;
  /**
   * The soonest it may start, as a time on the span's clock or an anchor. The fit never places it
   * sooner, and the children after it are laid out from where it starts. One already past when it is
   * cued places it there, partway through. One whose anchor has no answer yet waits, and under `queue` or
   * `stagger` so does every child after it.
   */
  earliest?: number | Anchor;
  /**
   * Where it plays among the span's children still to start. Lower goes first, and ties go as cued.
   * Default 0.
   */
  rank?: number;
}

/**
 * A circle by its center, `x` and `y`, and radius `r`. It is in the units of the positions `plot`
 * gave.
 *
 * @category voice
 */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * The host's own answer to where a `within` signal can be above 0. It works over any axes or
 * none. Once a
 * frame, `find` writes into `out`, from 0, the indices `place` or `plot` gave the subjects the
 * signal can be above 0 for, and returns how many it wrote. `out` has room for every index handed
 * out; a repeat is read once, and an index no subject holds is skipped.
 *
 * @category voice
 */
export interface Finder {
  find(out: Int32Array): number;
}

/**
 * What `cue` takes. That is a patch, and the clock, weight and reach it plays with.
 *
 * @category voice
 */
export interface VoiceSpec<I, O, H = unknown> extends SpanHints {
  // biome-ignore lint/suspicious/noExplicitAny: a patch naming no host fits a mix naming one
  patch: Patch<I, O, any, H>;
  /**
   * What `history.revive` rebuilds this spec from. It lets a history `store` page the voice out
   * once it has left. A voice cued without it stays in memory for as long as history reaches it.
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
   * The subjects this voice reaches, fixed at `cue` and matched by identity. A probe of any other
   * never asks this voice. Takes the place of `target`, and a cue giving both is refused, since a
   * predicate over a fixed list is that list filtered, which the host can do before cueing.
   */
  subjects?: readonly I[];

  /**
   * When the voice starts, in ms on the host's clock. That is the clock it passes `sync`: a rAF
   * timestamp and `performance.now()` share an origin, `Date.now()` does not. Default: the time the mix last
   * synced to, and 0 for a voice cued before the first sync, which that sync finds already as far
   * in as its timestamp. Where the host read `inert` as true since the last sync, its frame loop
   * may be asleep, and the default is the next sync instead, so a voice cued after a long pause
   * starts there rather than that far in.
   */
  start?: number;
  /**
   * Playback rate. 1 is real time; 0 freezes; below 0 plays backward, to end where the voice
   * starts as a voice playing forward ends where its last pass does: `played` resolves, and it
   * leaves over `fade.out` or, freezing before, holds its first frame.
   */
  rate?: number;
  /**
   * Where in itself the voice starts, in voice ms, as `seek` on its handle sets. Default 0, or
   * for a voice cued backward its end: `duration` times its passes. A voice with no end cued
   * backward (a loop for good, or a patch with no duration) starts at 0 and has no first pass
   * either: it plays into the pass before, `setting.pass` and `setting.elapsed` below 0, for
   * every subject from the voice's start whatever its stagger. A motion's stretches begin at 0,
   * so one cued backward with no `seek` has ended as it starts.
   */
  seek?: number;
  /**
   * The interval this voice's `step` runs at, in ms of mix time. It takes the place of the mix's
   * `stepMs`. 0 steps it once a frame by the frame's gap, whatever the mix sets. Default: the mix's.
   */
  stepMs?: number;
  /**
   * How a stateful subject first probed after its delay ran out starts stepping. `exact` steps it
   * from that origin, in one step capped by `maxDt` or every `stepMs` interval since, so its state
   * is the same however late the host looked. `fresh` starts it from the probe that first meets it,
   * with fresh state and no catch-up, on the `stepMs` grid counted from the origin: cheaper for a
   * subject met long after its voice started, and probe-dependent by design. A subject met on time,
   * and a handle `seek`'s rebuild, step the same either way. Default: `exact`.
   */
  catchUp?: 'exact' | 'fresh';
  /**
   * How many passes the voice plays. true loops for good, false plays one pass, n plays n passes.
   * A finite loop leaves when its
   * passes are done for its latest-staggered subject — over `fade.out` where one is set, at once
   * where none is — unless it freezes after. Default: false.
   */
  loop?: boolean | number;
  /**
   * Per-subject delay in voice ms. It is klieg's stagger grammar reduced to the one thing the mix
   * needs. It runs once per subject and the answer is kept: at `cue` for every subject a voice
   * names in `subjects`, else, like `target`, on first sight. So a voice naming its subjects ends by
   * all of them, and one reaching them by `target` ends by those the mix has been asked about: a
   * subject first read later than that sees a finite loop already over.
   */
  stagger?: (subject: I) => number;
  /**
   * Which edge frames a subject is shown while the voice is not playing. `before` shows the first
   * frame before it starts, while the voice is pending and while the subject waits out its
   * `stagger`; `after` shows the last frame of the last pass after a finite loop plays out; `both`
   * shows both. A frozen subject's clock stands still: `at` is asked for the edge frame and `step`
   * does not run, past one last step to the end of the last pass. `fade.in` counts from the first
   * frame the voice shows. A voice freezing after stays, `frozen`, until `fade()` or an anchored
   * `out` takes it out, so every one cued must be faded or it stays in the mix for good. Does
   * nothing to a motion patch, which keeps its target already. Default: neither.
   */
  freeze?: 'before' | 'after' | 'both';

  /** Steady weight, or a signal read per subject per frame. Default 1. */
  weight?: number | Signal<I, H>;
  /**
   * Where the `weight` signal can be above 0. It is a circle the host moves by writing to it, read
   * once a frame, over the positions `plot` or `put` gave, or a `Finder` the host answers by index.
   * Outside
   * it the voice gives a subject nothing and the signal is not read, so a frame visits only the
   * subjects within rather than all of them. The signal has to be 0 outside already, or the bound
   * cuts it off: outside production, every few frames, the mix reads it for a few subjects just
   * outside and warns once if one is above 0.
   * A patch that steps still steps outside, and a `from: 'current'` voice still takes its base,
   * as each does at weight 0. Needs `place` or `plot` first, and a signal `weight`.
   */
  within?: Circle | Finder;
  /** Ramp in and out, ms. Out applies on `fade()` and when a finite loop ends. */
  fade?: FadeSpec;
  /**
   * The role this voice plays; voices in one role are alternatives. Whichever plays it, the subject
   * shows one performance, not two stacked. The mix folds them through each channel's `lerp`.
   */
  role?: string;
  /** @deprecated Renamed `role`. Taken as `role`, with a warning outside production. */
  locus?: string;

  /** A `keys` voice whose first stop reads wherever this subject is now. */
  from?: 'current';
  /**
   * Words a source attaches to this voice. They let its events and its handle be taken as a set.
   */
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
   * Named marks inside the voice, beside its five. Each is at voice ms into a pass, as a hit's `at`
   * is: `{ drop: 340 }`. An anchor names one as it names the five, `{ of: 'lead', mark: 'drop' }`, and
   * `marks` lists it and `book` books it under its name. Each is reached once: on the first pass
   * that reaches it from where the voice starts, while its clock runs forward and before it ends.
   * A name cannot be one of the five.
   */
  marks?: Readonly<Record<string, number>>;
  /**
   * The owner this voice plays under, as a handle `owns` returned. Its `start` and `anchor` are then on
   * the owner's clock, in ms from when the owner starts, and default to where that clock is now; a
   * bare name in an anchor means a sibling, another voice the owner holds. Its clock runs on the
   * owner's, so the owner's rate, ramp and seeks move it, and its weight is multiplied by the
   * owner's weight and fade. Without a `freeze` of its own it takes the owner's.
   */
  owner?: Handle<I>;
}

/**
 * One of `mix.blend`'s members, with the labels it carries in place of the spec's. Each set here
 * replaces the spec's for this member alone. The rest of the spec times and places every member
 * alike, so they stay one blend.
 *
 * @category blending
 */
export interface BlendMember<I, O, H = unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: a patch naming no host fits a mix naming one
  patch: Patch<I, O, any, H>;
  /** What other voices call this member by. Default: the spec's `name`. */
  name?: string;
  /** The member's tags. Default: the spec's `tags`. */
  tags?: readonly string[];
  /** Events at times on this member's clock, as a voice's `hits`. Default: the spec's. */
  hits?: readonly Hit[];
}

/**
 * What `owns` takes. An owner has no patch, and plays only through the voices it holds.
 *
 * @category voice
 */
export interface OwnerSpec<I, H = unknown> extends SpanHints {
  /**
   * When the owner starts, on its own owner's clock. That is the host's clock for an owner on the
   * mix, as a voice's `start` is. Default: now.
   */
  start?: number;
  /**
   * Its clock's rate, multiplied into every child's own. Default 1. Below 0 its clock runs back,
   * and so does every child's: a child plays backward to its start and leaves there, as a voice cued
   * backward does, and the owner leaves with its last child. A span is not cued backward, since it
   * lays out its children forward from its start; its handle's `rate` turns it once it plays.
   */
  rate?: number;
  /**
   * Where its clock starts, ms, as `seek` on its handle sets. Its children play as far in as that
   * puts them. Default 0, cued backward too, since an owner has no end of its own to start from; one
   * cued at a rate below 0 with no seek runs back from 0, before any child placed on its clock.
   */
  seek?: number;
  /**
   * Multiplied into every child's weight per subject. It applies as the child's own fade does,
   * before the child's role folds it: a number, or a signal read per subject per frame. Default 1.
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
  /**
   * Where it sits relative to its own owner's clock or to other voices. It takes the place of
   * `start`.
   */
  anchor?: Placement;
  /**
   * Events at times on its own clock, which `book` hands a host ahead of time. That is the clock its
   * children's `start` counts on, and they go with its `score` and `tags`. An owner does not loop, so each is
   * booked once, while it plays: none past where it leaves, and none while its clock runs back.
   */
  hits?: readonly Hit[];
  /** Named marks at times on its own clock, as a voice's `marks`. */
  marks?: Readonly<Record<string, number>>;
  /** The owner it plays under, so owners nest. */
  owner?: Handle<I>;
}

/**
 * What `span` takes, an owner with a budget. It lays out the voices it holds in an order and fits
 * them into the budget.
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
   * How the children are fitted once they are retimed toward the budget. They are retimed faster
   * or slower as their hints allow. Default `pipe(condense(), shed())`.
   */
  fit?: Fit;
  /**
   * What happens where the fit leaves the children too long for a span at least `strong`.
   * `instant` jumps every child weaker than the span to its end at once, and `overrun` lets them run long.
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
 * A span's handle. It is an owner's, and reports how its children were last fitted.
 *
 * @category score
 */
export interface SpanHandle<I = unknown> extends Handle<I> {
  readonly result: FitResult;
}

/**
 * How a voice leaves when it is faded. It fades the whole voice, or one subject.
 *
 * @category blending
 */
export type FadeOptions<I = unknown> = VoiceFade | SubjectFade<I>;

/**
 * A fade of the whole voice, as `FadeOptions` takes it.
 *
 * @category blending
 */
export interface VoiceFade {
  /** The ramp, ms. Defaults to the voice's own `fade.out`. */
  over?: number;
  /**
   * When the fade begins, as a mix time or `'rest'`. A mix time: ahead, the voice plays untouched until then and begins
   * its fade exactly there, its `out` mark fixed from now, and `rise` before then takes it
   * back with nothing changed; at or behind now, the fade began then and is partway. `'rest'`:
   * leave per subject at the first frame that subject's contribution is at rest. Default now.
   */
  at?: number | 'rest';
  /** Ms after which the voice leaves whether or not it rested. */
  deadline?: number;
  subject?: never;
}

/**
 * A fade of one subject out of a voice, as `FadeOptions` takes it.
 *
 * @category blending
 */
export interface SubjectFade<I = unknown> {
  /**
   * The one subject to fade out of this voice, which plays on for the rest. Once the ramp ends
   * the voice forgets the subject and reaches it no more, until a motion patch's `to` or `push`
   * or the mix's `drop` brings it back, met afresh: `from` and `target` asked again, and
   * `stagger` too unless the voice names its `subjects`.
   */
  subject: I;
  /** The ramp, ms. Defaults to the voice's own `fade.out`; 0 takes the subject out at once. */
  over?: number;
}

/**
 * The live controls on one voice, returned by `cue`.
 *
 * @category voice
 */
export interface Handle<I = unknown> {
  readonly id: number;
  /**
   * Where the voice is in its life. `frozen`: a voice freezing after has played every pass and shows
   * its last frame until faded.
   */
  readonly state: 'pending' | 'live' | 'frozen' | 'fading' | 'done';
  /** The handle of the owner this voice plays under. Undefined for one on the mix clock. */
  readonly owner: Handle<I> | undefined;
  /**
   * The voice's weight now, which can be written while it plays. A write shows at the next probe.
   */
  weight: number;
  /**
   * Playback rate now. Setting it changes speed at once; `ramp` eases into a new one. On a voice
   * still pending, a rate or a ramp applies from the voice's start, which stays where it is: at
   * rate 0 it starts on time and holds its first frame.
   */
  rate: number;
  /**
   * Moves the rate to `rate` linearly over `over` mix ms. A pause or a slow-motion then eases in
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
   * Turns a fade out around, so the voice plays on as if never faded. It climbs back from where its
   * fade had got to, up the same curve, over `over` ms for the whole curve (default its `fade.in`, else its `fade.out`). A fade waiting for rest is taken back at once; a voice not fading
   * is left as it is. A voice whose own end began the fade starts it again at its next frame. A
   * voice faded before its start goes back to `pending` and starts on time.
   */
  rise(opts?: { over?: number }): void;
  /**
   * The weight this voice gave `subject` the last frame that subject was probed. That is after its
   * fades and its weight signal, before a role folds it with its alternatives. 0 for a subject it does
   * not reach, has not started on and does not freeze before, has left at rest, or has never been
   * probed for; 0 once done, and 0 after `mix.seek` goes back until the subject is probed again.
   * Costs nothing until it is asked.
   */
  weightOf(subject: I): number;
  /**
   * Heads `subject` for `target`, for a voice playing a `spring` or a `tween`. It is the patch's own
   * `to`, reached without holding the patch. Throws for any other voice.
   */
  to(subject: I, target: Value, at?: number): void;
  /**
   * Sets `subject` moving at `velocity`, for a voice playing a `spring` or a `glide`. The velocity
   * is in units per second, and this is the patch's own `push`. Throws for any other voice.
   */
  push(subject: I, velocity: Value, at?: number): void;
  /**
   * Puts `subject` at `value`, keeping its velocity, for a voice playing any motion patch. It is the
   * patch's own `set`. Throws for any other voice.
   */
  set(subject: I, value: Value, at?: number): void;
  /**
   * Where `subject` is and how fast it moves, for a voice playing a motion patch. It is the patch's
   * own `read`. Undefined for any other voice, and wherever the patch's `read` is.
   */
  read(subject: I, at?: number): Motion<Value> | undefined;
  /** Resolves when the voice has been removed from the mix, however that happened. */
  readonly done: Promise<void>;
  /**
   * Resolves true when a finite loop's last pass ends, false if the voice leaves before that. The
   * last pass is the one for its latest-staggered subject; `stagger` says which subjects count.
   * Never rejects.
   */
  readonly played: Promise<boolean>;
}

/**
 * What `Handle.seek` does with each subject's state. `rebuild` (the default) makes it fresh and
 * steps it to the new position; `keep` leaves it as it was, except for a subject the seek sends back
 * before its start, which starts afresh there.
 *
 * @category voice
 */
export interface SeekOptions {
  state?: 'rebuild' | 'keep';
}
