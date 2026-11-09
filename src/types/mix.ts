import type { ArcHandle, ArcSpec } from './arc.js';
import type { Kit } from './channel.js';
import type { HistoryOptions, Tape } from './history.js';
import type { Band, Easing, Patch, Sent, Signal } from './patch.js';
import type { Booker, BookOptions, Marked } from './place.js';
import type { Trace, TraceOptions } from './trace.js';
import type { Transport } from './transport.js';
import type {
  BlendMember,
  Circle,
  Handle,
  OwnerSpec,
  SpanHandle,
  SpanSpec,
  VoiceSpec,
} from './voice.js';

/**
 * How a mix is built. It names the engine, reduced motion, the host, and the mix's limits.
 *
 * @category mix
 */
export interface MixOptions<H = unknown> {
  engine?: Engine;
  /** Whether motion is reduced. Fades and warm-ups then snap, and {@link Setting.dt | `dt`} reads Infinity. */
  reduce?: boolean | (() => boolean);
  /** Merged into every `setting.host`. Its type is the mix's `H`, which every patch and signal it cues reads. */
  host?: H;
  /**
   * The band a rest-less channel's contribution switches on and off across. Default: on at any weight
   * above 0, off at 0, so the contribution passes whole while its voice has any weight.
   */
  band?: Band;
  /**
   * Tags that act as roles. A voice carrying one folds with the others carrying it, as if its
   * {@link VoiceSpec.role | `role`} named that tag.
   */
  roles?: readonly string[];
  /** @deprecated Renamed `roles`. Taken as `roles`, with a warning outside production. */
  loci?: readonly string[];
  /**
   * The most {@link Setting.dt | `dt`} a {@link Patch.step | `step`} or signal is handed, however long the gap. Off by default, since a
   * patch with a closed form wants the whole gap; an integrator wants this set.
   */
  maxDt?: number;
  /**
   * A fixed interval, ms, to run every {@link Patch.step | `step`} at. Without it each {@link Patch.step | `step`} runs once by the frame's
   * gap; with it stateful patches play the same at any frame rate. Intervals count from when a
   * subject's delay ran out, the remainder carrying to the next sample; `maxDt` then caps how many
   * one sample may run. Signals and {@link Patch.at | `at`} still see the frame. Off by default.
   */
  stepMs?: number;
  /**
   * What the mix remembers so {@link Mix.project | `project`} and {@link Mix.seek | `seek`} can read back. {@link HistoryOptions.ms | `ms`} is how far back {@link Mix.project | `project`}
   * may read, in ms of mix time, and {@link HistoryOptions.every | `every`} how often a stateful voice's state is kept per subject
   * on the way, in ms (default 200). Within it the mix remembers what it cued, every change a
   * handle made and when, the voices that have left, and those copies of state, so a read back
   * restores the nearest copy and steps forward from it. Off by default, and a mix without it keeps
   * nothing. With {@link HistoryOptions.inputs | `inputs`}, it also keeps what each input signal on a voice's weight read per
   * subject, and the host fields patches {@link Patch.reads | `reads`}, each time they changed, so a read back over a
   * `level` or a pointer is known rather than held. With {@link HistoryOptions.tape | `tape`}, the mix also records every call
   * the host makes on it, its handles and its motion patches, so {@link Mix.seek | `seek`} can move it and play those
   * calls again.
   */
  history?: HistoryOptions;
  /**
   * A subject's key, for a history {@link HistoryOptions.store | `store`}. It is unique among this mix's subjects for the session.
   * A string or number subject is its own key; with a store, an object subject needs this.
   */
  keyOf?(subject: never): string | number;
  /**
   * What a debugger calls a subject (see `watched`). Where it gives nothing, the debugger uses the
   * subject's own `name` or `id`, a DOM element's tag, id and classes, or its class and a number.
   */
  labelOf?(subject: never): string | undefined;
  /**
   * Whether a channel may run as a lane. A lane computes every subject at once in flat arrays, when
   * every voice writing the channel can run that way. On by default; what a host reads is the same
   * either way ({@link Mix.probe | `probe`}, `pull`, `atRest`, {@link Handle.weightOf | `weightOf`}, {@link Mix.inert | `inert`} and {@link Mix.project | `project`}), so turning it off is
   * for ruling a lane out, or for comparing against. A voice weighted by an input signal `input`
   * did not make, or whose patch reads host fields, never runs on a lane, since a change to either
   * between two probes would not reach it. Two things differ: a stateless patch's `setting.send`
   * from {@link Patch.at | `at`} sends for every subject a lane fills, those probed this frame or the last, and a
   * patch that first calls `setting.keep` partway through playing can advance that state once more
   * for one subject probed the frame before (see `Setting.keep`).
   */
  lanes?: boolean;
  /**
   * Whether a host that probes into its own object ({@link Mix.probe | `probe(subject, out)`}) will
   * cue a voice `from: 'current'`. With it, each such probe keeps the subject's last two poses, so the
   * first of those voices starts where the subject was and leaves at its speed. Without it, the mix
   * keeps nothing until one is cued, and that first voice starts from this frame's pose, standing,
   * and from rest where the voice before it was cut off in the same frame; every later one reads the
   * poses kept since. Off by default, as it costs a 10,000-subject probe frame 35–70%. A host reading
   * through `pull`, or a probe with no `out`, needs no option.
   */
  retargets?: boolean;
  /**
   * The transport this mix plays on, shared with other mixes. They then keep one clock, and a query
   * naming a score looks in all of them. The transport's {@link Transport.sync | `sync`}, {@link Transport.rebase | `rebase`}, {@link Transport.rate | `rate`}, {@link Transport.ramp | `ramp`} and
   * {@link Transport.seek | `seek`} move it, and the mix's own throw. Its history is the transport's, so the mix takes no
   * `history` of its own.
   */
  transport?: Transport;
  /** What `Marked.mix` and errors call this mix. */
  name?: string;
}

/**
 * How sure a projection is of one channel. It is `exact` where only the clock and known changes
 * drove it; `stepped` where state was advanced across a gap in one go, which is as good as the
 * patch's step makes it, or a signal's state was read back from a copy; `held` where it depends on
 * input from outside the clock, whose value at that time is not known, so the value it had is held.
 *
 * @category mix
 */
export type Doubt = 'exact' | 'stepped' | 'held';

/**
 * The mix read at another time, with nothing in the live mix moved. It gives what `probe` would
 * give at that timestamp. Valid until the mix is next synced or cued.
 *
 * @category mix
 */
export interface Projection<I, O> {
  /** Mix time: the time it reads at, not a host timestamp. */
  readonly timestamp: number;
  /** The merged pose for one subject at this projection's timestamp. */
  probe(subject: I, out?: O): O;
  /** How sure that pose is, per channel. The least sure voice that fed a channel decides. */
  assess(subject: I): { [K in keyof O]-?: Doubt };
}

/**
 * Arrays for `pull` to write, one per channel it reads. It reads any channel whose value is a
 * number or an array of numbers.
 *
 * @category mix
 */
export type Columns<O> = {
  [K in keyof O as NonNullable<O[K]> extends number | readonly number[] ? K : never]?: Float64Array;
};

/**
 * The voices playing over one kit. Each frame, after `sync`, `probe` combines whatever the voices
 * contribute to a subject into that subject's pose, by the arithmetic each channel in the kit sets.
 *
 * @category mix
 */
export interface Mix<I, O, H = unknown> {
  /** Cues a voice. Throws when the engine cannot run the patch's form, or the kit lacks a channel. */
  cue(spec: VoiceSpec<I, O, H>): Handle<I>;
  /**
   * Cues N voices into one role, their weights split from one signal. They fold as alternatives.
   * The signal is read once per subject per frame, with the first member's setting, and every
   * member takes its share of that one reading, which `share` reads outside the blend; a signal
   * keeping state keeps it once, not per member. One `spec` cues them all, and a member given as a
   * `BlendMember` carries its own {@link BlendMember.name | `name`}, {@link BlendMember.tags | `tags`} and {@link BlendMember.hits | `hits`} in place of the spec's.
   */
  blend(
    // biome-ignore lint/suspicious/noExplicitAny: a patch naming no host fits a mix naming one
    members: readonly (Patch<I, O, any, H> | BlendMember<I, O, H>)[],
    by: Signal<I, H>,
    spec?: Omit<VoiceSpec<I, O, H>, 'patch' | 'weight' | 'role' | 'locus' | 'within'>,
  ): Handle<I>[];

  /**
   * Cues an owner, a voice with no patch that plays other voices on its own clock. It holds the
   * voices cued with {@link VoiceSpec.owner | `owner`} set to its handle, so they can be placed, timed and faded as one. Its
   * handle acts on all of them: {@link Handle.rate | `rate`} and {@link Handle.ramp | `ramp`} multiply into theirs, {@link Handle.seek | `seek`} moves their clocks
   * with its own and rebuilds their state as it does a voice's, and {@link Handle.weight | `weight`} and {@link Handle.fade | `fade()`} multiply
   * into their weights, by what its {@link Handle.weightOf | `weightOf`} reports; it fades as a whole, not by subject or at
   * rest. It is {@link Handle.played | `played`} once every voice it held has finished its passes, and leaves, {@link Handle.done | `done`}, with
   * its last; a fade that ends takes the rest with it. One that never holds a voice stays until
   * faded. Owners nest. Throws for a `loop`: a pass would have to restart its children.
   */
  owns(spec: OwnerSpec<I, H>): Handle<I>;
  /**
   * Cues a span, an owner that fits the voices it holds into its {@link SpanSpec.duration | `duration`}. It lays them out in
   * {@link SpanSpec.order | `order`}, again each time one joins or leaves early. A child's start and rate are the span's to
   * set, so it takes neither {@link VoiceSpec.start | `start`} nor an anchored start; its `SpanHints` say how it may give
   * way. A span with a budget stays until the budget has passed, though its children finish sooner,
   * so late ones can still join, and its `end` mark is where its children end or its budget does,
   * whichever is later. A voice that loops for good cannot join one. Throws for a `rate` below 0: a
   * span lays its children out forward from its start, and its handle's `rate` turns it once it
   * plays.
   */
  span(spec: SpanSpec<I, H>): SpanHandle<I>;
  /**
   * Cues an arc, an owner holding three parts that hand over in order. On its clock {@link ArcSpec.enter | `enter`} plays,
   * then {@link ArcSpec.active | `active`} for the {@link ArcSpec.hold | `hold`}, then {@link ArcSpec.exit | `exit`}, each a voice or several layered. Its marks are its
   * own: `start` as the enter begins, `in` as it ends, `coast` as the hold ends and `out` as the
   * exit begins, which are one time, and `end` as the exit ends, where it leaves and {@link ArcHandle.done | `done`}
   * resolves. While the hold is open, `coast`, `out` and `end` are unknown until `release` fixes
   * them. Each part shows its first and last frames through the blends either side of it, and a
   * part left out leaves its time to the one before it. Its {@link ArcHandle.fade | `fade`} takes it out with no exit. An
   * arc with a finite hold may sit in a span. Throws for a `rate` below 0, a hold below 0, and an
   * {@link ArcSpec.enter | `enter`} or {@link ArcSpec.exit | `exit`} that never ends.
   */
  arc(spec: ArcSpec<I, O, H>): ArcHandle<I>;

  /**
   * The host reports the clock, once a frame. Nothing advances at the call. Throws for a timestamp
   * earlier than the last sync's, short of a `rebase`: the host's clock only goes forward, and
   * `seek` moves the mix.
   */
  sync(timestamp: number): void;
  /**
   * Leaves the time between the last sync and the next one uncounted. A host calls it when a hidden
   * tab comes back. Every voice, fade and subject resumes where it was left.
   */
  rebase(): void;
  /**
   * The mix's own playback rate, multiplied into every voice's. 1 is real time and 0 pauses the
   * whole mix. A negative rate throws: the mix plays only forward, and `seek` moves it back.
   * Setting it changes speed at once; `ramp` eases into a new one. It scales mix time, which
   * everything a voice owns runs on: its clock, its fades and a handle's ramp, {@link VoiceSpec.stagger | `stagger`}, an
   * anchor's `by`, {@link MixOptions.stepMs | `stepMs`}, {@link MixOptions.maxDt | `maxDt`}, `history.ms`, every {@link Setting.dt | `dt`}, and `setting.timestamp`. Timestamps
   * on the host's clock name the same moment whatever the rate does: a {@link VoiceSpec.start | `start`}, an anchor given as
   * a number, an announced mark, what `marks` reports and the time `project` reads, so a start
   * ahead of a paused mix waits for the host's clock to reach it. A weight signal is still asked at
   * every probe, so one reading host input follows it while the mix is paused.
   */
  rate: number;
  /**
   * Moves the mix's rate to `rate` linearly over `over` ms of the host's clock. It works as
   * `Handle.ramp` does on a voice's. Mix time integrates the ramp and a voice's clock integrates
   * mix time, so a ramp on both multiplies and every position stays continuous. A later `rate`
   * write or `ramp` replaces it.
   */
  ramp(rate: number, over: number): void;
  /**
   * The mix time the clock will read at host `timestamp`, by the rate and any ramp in force at the
   * last sync, so a host can say where a moment ahead falls in mix time, as `trace` takes it.
   * `rebase` and `seek` are counted as the clock stands; a later rate write or ramp changes the
   * answer. Meant for timestamps at or after the last sync.
   */
  time(timestamp: number): number;
  /**
   * The host timestamp at which the clock reads mix time `time`, the inverse of
   * {@link Mix.time | `time`}: the earliest, by the rate and any ramp in force at the last sync,
   * and Infinity where the clock stops short of it. Meant for times at or after `now`.
   */
  when(time: number): number;
  /**
   * The merged pose for one subject at the synced frame, written into `out` when given. Without
   * it, each call makes a new object, so a host reading every subject every frame passes `out` or
   * reads by `pull`. An array `out` already holds for a `vec` channel, a `quat` that
   * runs on a lane, or a `color` that averages in OKLab or runs on a lane, is written in place where it is the channel's length, so a host that
   * kept one from an earlier probe into the same `out` sees it change: copy what has to outlast the
   * next probe.
   */
  probe(subject: I, out?: O): O;
  /**
   * A new empty pose, to pass as `probe`'s `out`. Each call makes its own object, holding every
   * channel with a rest in kit order: a number rest at its value, any other `undefined` until a
   * probe writes it. Make one and pass it as `probe`'s `out` every frame. An `out` made as `{}` or
   * a literal shares V8's shapes with the host's other small objects, which can leave each number
   * written into it boxed; this one has a shape of its own, so the mix writes numbers into it
   * without allocating.
   */
  pose(): O;
  /**
   * Writes each subject's pose into arrays, one per channel. Subjects go in the order given, each
   * as `probe(subject, out)` gives it, without a pose object per subject. A channel of `n` numbers
   * takes `n` places per subject, side by side; one with no value for a subject writes NaN there.
   * Fastest while every voice runs on a lane, and when `subjects` is an array read again in the
   * same order: the mix remembers the last array's subjects by position, holding them until the
   * next `pull`, and skips looking up any still in its place. Throws when an array is too short for
   * the subjects.
   */
  pull(subjects: Iterable<I>, into: Columns<O>): void;
  /**
   * Reads the mix at another mix time, without moving it. At the mix's own time it reads what
   * `probe` does: what the host has done since the last sync lands at the next. Ahead of the mix
   * it plays what is cued forward, with the calls the tape holds after a `seek` back, and while a
   * voice could carry state (a patch that steps, a signal weight) it reads each subject asked about
   * at every known event on the way: each call, and each mark `marks` would list. It throws
   * for the two a copy cannot take: a `drop` of a subject a motion patch holds, and a retarget or
   * push made before its voice met the subject. Behind it, with {@link MixOptions.history | `history`}, it reads the last frame at or before `time`
   * as that frame showed, and throws for a time older than the history reaches. On a transport it
   * reads every mix on it together, so anchors across them answer.
   *
   * Without {@link MixOptions.history | `history`} it reads back only where how the mix stands now says what it showed then,
   * and throws otherwise, saying why. Every voice has to play as it was cued and read by its clock
   * alone: no state, motion, `from: 'current'`, anchor or owner, no write to its handle, and no channel without a rest
   * at a weight that moves. The mix's rate has never been set. And `time` is no earlier than the
   * last cue, `drop`, `touch`, `announce` or `rebase`, or the last frame a voice left in.
   *
   * Given `{ frame }`, a number `seq` read, it reads that frame as it showed, as `seek` does; it
   * needs {@link MixOptions.history | `history`}.
   */
  project(at: number | { readonly frame: number }): Projection<I, O>;
  /**
   * Reads the mix over a window of mix time, `from` to `to`, without moving it, as `project` reads
   * one moment: `trace.of(subject, channel)` gives that channel as points joined by straight lines.
   * Where every voice feeding the channel is a `keys` voice or a tween whose shape is known through
   * the window, the points are its own breakpoints and the lines are exact; elsewhere the run is
   * read every {@link TraceOptions.grid | `grid`} ms, as many `project` calls would read it. A stretch eased other than
   * `linear`, or a tween's stretch, is known but not straight: it is read on the grid, or with
   * {@link TraceOptions.bends | `bends`} given as its two ends and a {@link Bend}. A `steps` easing is straight between its jumps, which come as breakpoints.
   *
   * Exact needs, of each voice reaching the subject and writing the channel: a `keys` patch whose
   * stops are plain numbers, eased `linear` or `steps` (or any easing, with `bends`), or a `tween`
   * with no retarget timed inside the window (one with no time counts from when it was made); a
   * number weight; no owner, anchor, role, blend, {@link VoiceSpec.within | `within`},
   * {@link VoiceSpec.stepMs | `stepMs`}, or `from: 'current'`; no ramp of its rate under way; a fade in finished by
   * `from` and no fade out under way or due. The channel folds by `sum`, or by `mul` from one such
   * voice, and has no `bounds`; with `bends`, no more than four bending stretches overlap. The
   * window lies at or after the mix's own time, and the tape holds no calls ahead.
   */
  trace(from: number, to: number, opts?: TraceOptions): Trace<I, O>;
  /**
   * Moves the mix to mix time `time` and plays on from there. It lands as the mix stood at the end
   * of that frame; where rate 0 held the clock at `time` for several frames, the last of them.
   * Needs {@link MixOptions.history | `history`} with a `tape`, which records the host's calls by the host time they were made
   * at.
   *
   * Back, the mix restores itself: controls, records, voices and marks as they stood then. Voices
   * that left after it are back on the handles the host holds, their {@link Handle.done | `done`} and {@link Handle.played | `played`} starting
   * over where they had settled since. Voices cued after it wait as `pending` until the mix plays
   * their cue again, and a write to the handle of one waiting changes nothing. Stateful voices
   * restart from the copy {@link MixOptions.history | `history`} kept nearest before it and step once to it, exact under
   * {@link MixOptions.stepMs | `stepMs`}. A subject faded out of a voice or dropped after it comes back with the record it had,
   * a motion patch's state included. Recorded input and host fields after it are let go: after a
   * seek back, signals and host fields read live again, and `assess` reports what they fed as
   * `held`.
   *
   * Forward, through a sync or a later seek, the mix plays the recorded calls again in the frames
   * they were made in: cues, handle writes, fades, retargets and pushes, its rate, marks, `mute`
   * and `drop`. A call the host makes while there are recorded calls ahead starts a new branch, and
   * the tape keeps the old future beside it; `tape.switchBranch` picks one back. Playing past a
   * time again sends its events and books its marks and hits again.
   *
   * The host goes on passing its own clock: the next `sync` reads the moment sought plus the host's
   * time since its last sync. Throws for a time older than history reaches, and before the first
   * sync. With a history {@link HistoryOptions.store | `store`}, a time older than memory needs `prepare` first, or throws
   * `HistoryMiss` before anything moves.
   *
   * Given `{ frame }`, a number `seq` read, it moves to the end of that frame instead, which is how
   * a host reaches an earlier one of several frames rate 0 held at one mix time. The frame has to
   * be one history still holds: not let go with age, and not after a moment an earlier seek went
   * back to. With a store, one older than memory needs `prepare` of its mix time first.
   */
  seek(to: number | { readonly frame: number }): void;
  /** As `Transport.prepare`, for a mix made alone. */
  prepare(time: number): Promise<void>;
  /**
   * The mix clock at the last sync or seek. It is the time `seek` and `project` take; NaN before
   * the first sync. Host time at the mix's rate, less what `rebase` took out and `seek` moved.
   */
  readonly now: number;
  /** Host time: the host's timestamp at the last sync; NaN before the first. */
  readonly timestamp: number;
  /**
   * Mix time played by syncs since the mix began, each sync counting what it moved the clock on,
   * from the last sync or the seek since, and no more than {@link MixOptions.maxDt | `maxDt`}. A seek or a {@link Mix.rebase | `rebase`} adds nothing,
   * so it never goes back. A driver owing output per mix time owes the difference since its last write.
   */
  readonly played: number;
  /**
   * The number of the frame being played. `seek({ frame })` and `project({ frame })` take it. Each
   * sync and seek begins a frame with a higher one, so two frames at one mix time differ.
   */
  readonly seq: number;
  /** The tape `history.tape` made, undefined without one. */
  readonly tape: Tape | undefined;
  /**
   * Whether every channel is at rest for this subject this frame. A host can then skip the write.
   * After a probe of the subject this frame, it answers for the pose that probe gave, without
   * folding again.
   */
  atRest(subject: I): boolean;

  /**
   * A handle on every voice still in the mix, in the order they were cued. That includes pending,
   * live, frozen and fading voices; given a tag, only the voices whose {@link VoiceSpec.tags | `tags`} carry it. Each is the
   * handle `cue` returned for that voice, so a listed handle is `===` the cued one.
   */
  voices(tag?: string): Handle<I>[];
  /** Anything still contributing, fading, or pending. */
  readonly live: boolean;
  /**
   * Whether another frame would change no pose, so a host's frame loop may sleep. It holds when
   * every voice is done, frozen at a plain weight, or a motion whose every subject has landed on
   * its target. At rate 0 it is enough that every voice not done has started, at a plain weight,
   * with no anchor. A change made since the last sync, a retarget or a rate included, makes it
   * false until the next. Read as true, it tells the mix the host may sleep: a voice cued with no
   * {@link VoiceSpec.start | `start`} before the next sync starts at that sync.
   */
  readonly inert: boolean;
  /**
   * Calls `fn` when a host call makes the mix need frames again after a sync. Such a call is a cue,
   * a fade, a handle's or the mix's rate, a seek, a `drop`, or a motion retargeted. It fires once
   * until the next sync clears the change, and never during `sync`. Returns a function that
   * unsubscribes `fn`. A frame loop sleeping on `inert` subscribes here to wake.
   */
  onWake(fn: () => void): () => void;
  /**
   * Calls `fn` each time the mix is sought, by its own `seek` or its transport's, once the seek has
   * landed: the mix can be read at the time sought, before any sync, as a paused host scrubbing
   * reads it. A driver holding state of its own learns here what to take back. Returns a function
   * that unsubscribes `fn`.
   */
  onSeek(fn: (sought: Sought) => void): () => void;
  /**
   * Makes a call of a driver's own, `fn`, now, and keeps it on the tape beside the host's calls, so
   * the mix makes it again wherever it plays them again: forward past it after a seek back, and on
   * a branch `tape.switchBranch` picks. It is a host call like any other: made while the tape holds
   * calls ahead, it starts a new branch, and what the mix does inside `fn` is part of it, made
   * again with it rather than recorded apart. On a seek back to before it, the driver takes back
   * what `fn` did, by {@link Mix.onSeek | `onSeek`}. A read ahead does not make it. Without a
   * `history.tape` it only calls `fn`.
   */
  call(label: string, fn: () => void): void;
  /**
   * Takes the mix off the list debuggers read (see `watched`). It is for a host done with it, where
   * it would otherwise stay until collected. Stops every watcher, and frees a hold no other listed
   * mix on its transport shares. It still plays if synced.
   */
  close(): void;
  /** Fades every voice out. The ramp is `over` when given, else each voice's own `fade.out`. */
  mute(opts?: { over?: number }): void;
  /**
   * Forgets a subject's state, so nothing keeps the subject alive. That includes a motion patch's
   * state for the subject, and any fade of the subject out of a voice.
   */
  drop(subject: I): void;
  /**
   * Says that something a patch reads from outside the mix has changed since the last sync. One
   * such thing is a table its {@link Patch.at | `at`} looks a subject up in. The next probe calls the patch again
   * where it would have answered with what it read this frame. Given a subject, for that subject
   * only; with none, for every subject. The clock stays where it is and no {@link Patch.step | `step`} runs again, and
   * it wakes a frame loop sleeping on `inert`, as any change does.
   */
  touch(subject?: I): void;
  /**
   * The subject's index, which a {@link VoiceSpec.within | `within`} finder names it by. It is the one it has, or a new one.
   * It keeps it until `drop`, or, for an object, until the host lets it go; then the index is
   * handed to the next subject placed. A subject placed with no `plot` has no position until `put`
   * gives it one.
   */
  place(subject: I): number;
  /**
   * Gives the mix each subject's index and position at once, for voices cued {@link VoiceSpec.within | `within`} a circle. The
   * index is the subject's place in `subjects`, and `xy` holds two numbers a subject, `x` then `y`,
   * in that order. It is read in place, so a host moving its subjects writes into it and calls
   * `moved`. `cell` sizes the grid the mix finds subjects in, best near the radius the circles use;
   * by default, about two subjects a cell. Another call replaces the list and every index. A
   * subject `place`d after it takes an index freed by `drop`, which reads whatever `xy` holds
   * there, or one past the list, which has no position. Throws for an `xy` shorter than two numbers
   * a subject.
   */
  plot(subjects: readonly I[], xy: Float64Array, cell?: number): void;
  /** Says the host wrote new positions into the array it gave `plot`. The next frame reads them. */
  moved(): void;
  /**
   * Moves one subject to (`x`, `y`), for a host where few move at once. It writes into the array
   * `plot` was given, so the host's array holds the move too, or with no `plot`, into the mix's
   * own, and the grid is built again only once many subjects have left their cells. The same as
   * writing the array and calling `moved`; the two mix freely. Throws for a subject with no index,
   * and for one whose index is past the array `plot` was given.
   */
  put(subject: I, x: number, y: number): void;
  /**
   * A weight signal over the positions `plot` or `put` gave, highest at a circle's center. It is 1
   * at the center, falling with distance to 0 at {@link Circle.r | `r`} and beyond, along `ease` read from the edge
   * (0) to the center (1), linear by default. The host moves or resizes the circle by writing to
   * it. A voice it weighs is bounded to the circle as if cued {@link VoiceSpec.within | `within`} it, with no check, since the
   * circle is the signal's own edge, from the first `place` or `plot` for one cued before it. A
   * subject with no position reads 0.
   */
  around(circle: Circle, opts?: { ease?: Easing }): Signal<I, H>;
  /**
   * Puts a named mark on a score, for anchors to target as they target a voice's marks. A voice
   * placed `{ with: 'reply' }` waits until the host announces `reply`. {@link AnnounceOptions.at | `at`} is a timestamp on the
   * host's clock, default now, and may lie ahead, so a read ahead sees it. A mark stays while it is
   * ahead or while the mix's history reaches it.
   */
  announce(name: string, opts?: AnnounceOptions): void;
  /**
   * Every mark the plan knows between two timestamps on the host's clock, earliest first. They are
   * when voices start, are fully in, end their last pass, begin to fade and are gone, and what the
   * host announced. A mark nothing has fixed yet, such as the out of a voice that loops for good,
   * is not listed.
   */
  marks(from: number, to: number): Marked[];
  /**
   * Every event patches have sent since the last drain, earliest first. Where two share a
   * timestamp, they come in the order they were sent. A subject's events are made while it catches
   * up, which is when it is probed, so one nobody probes has sent nothing yet: promptness is the
   * host's, by probing. A stateless patch's {@link Patch.at | `at`} on a lane is the exception: it runs at the frame's
   * first probe for every subject probed that frame or the last. Under {@link MixOptions.stepMs | `stepMs`} each carries the
   * end of the interval it happened in, so what is sent and when does not depend on how the host
   * spaces its probes. Time `rebase` took out sends nothing. Given a tag, it takes only the events
   * of voices carrying it and leaves the rest for whoever drains them.
   */
  drain<E = unknown>(tag?: string): Sent<I, E>[];
  /**
   * Hands the host each mark and hit ahead of time, against a clock of its own. The host can then
   * schedule the thing itself: a sound on an `AudioContext`, a MIDI message with a timestamp, a
   * video loaded before the voice that shows it starts. Booking runs at each `sync`, {@link BookOptions.ahead | `ahead`} ms
   * out, and a booking whose time moves is stopped and taken again. Nothing is booked twice: a mark
   * is known by its voice and which mark, a hit by its voice, index and pass. `project` books
   * nothing, and nothing about booking is replayed under {@link MixOptions.history | `history`}. A mix with no booker pays
   * nothing for it.
   */
  book<E = unknown>(opts: BookOptions<E, I>): Booker;
}

/**
 * Where a seek landed, as {@link Mix.onSeek | `onSeek`} hands it over.
 *
 * @category mix
 */
export interface Sought {
  /** Mix time: where it landed. */
  readonly at: number;
  /**
   * The last frame it kept. A seek back lets go of every frame after it, so what a driver logged
   * in a later frame is from a future the tape makes again, as a history store's `cut` is told; a
   * seek forward keeps every frame, and this is the one it ends in.
   */
  readonly frame: number;
  /** Whether it went back. */
  readonly back: boolean;
}

/**
 * What `announce` takes besides the mark's name.
 *
 * @category mix
 */
export interface AnnounceOptions {
  /** Host time: a timestamp on the host's clock, which may lie ahead. Default now. */
  at?: number;
  /** The score the mark goes on. Default: the mix's one unnamed score. */
  score?: string;
  tags?: readonly string[];
}

/**
 * The code that does a mix's work: playing its voices and working out each subject's pose. `mixer`
 * is the one every mix uses by default. An engine names the kinds of patch it can play in `runs`,
 * and makes mixes with `create`.
 *
 * @category engine
 */
export interface Engine {
  readonly name: string;
  /** Which patch forms this engine can run. A voice it cannot run is refused at `cue`, by name. */
  readonly runs: ReadonlySet<'fn' | 'keys' | 'motion'>;
  create<I, O, H = unknown>(kit: Kit<O>, opts: MixOptions<H>): Mix<I, O, H>;
}
