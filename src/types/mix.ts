import type { ArcHandle, ArcSpec } from './arc.js';
import type { Kit } from './channel.js';
import type { HistoryOptions, Tape } from './history.js';
import type { Easing, Patch, Sent, Signal } from './patch.js';
import type { Booker, BookOptions, Marked } from './place.js';
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
   * The band a rest-less channel's contribution switches on and off across. Default: on at any weight
   * above 0, off at 0, so the contribution passes whole while its voice has any weight.
   */
  band?: { on: number; off: number };
  /**
   * Tags that act as roles: a voice carrying one folds with the others carrying it, as if its `role`
   * named that tag.
   */
  roles?: readonly string[];
  /** @deprecated Renamed `roles`. Taken as `roles`, with a warning outside production. */
  loci?: readonly string[];
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
  history?: HistoryOptions;
  /**
   * A subject's key, for a history `store`: unique among this mix's subjects for the session. A
   * string or number subject is its own key; with a store, an object subject needs this.
   */
  keyOf?(subject: never): string | number;
  /**
   * What a debugger calls a subject (see `watched`); where it gives nothing, the subject's own
   * `name` or `id`, a DOM element's tag, id and classes, or its class and a number.
   */
  labelOf?(subject: never): string | undefined;
  /**
   * Whether a channel may run as a lane: computed for every subject at once in flat arrays, when
   * every voice writing it can run that way. On by default; what a host reads is the same either
   * way (`probe`, `pull`, `atRest`, `weightOf`, `inert` and `project`), so turning it off is for
   * ruling a lane out, or for comparing against. A voice weighted by an input signal `input` did not
   * make, or whose patch reads host fields, never runs on a lane, since a change to either
   * between two probes would not reach it. Two things differ: a
   * stateless patch's `setting.send` from `at` sends for every subject a lane fills, those probed
   * this frame or the last, and a patch that first calls `setting.keep` partway through playing can
   * advance that state once more for one subject probed the frame before (see `Setting.keep`).
   */
  lanes?: boolean;
  /**
   * The transport this mix plays on, shared with other mixes, so they keep one clock and a query
   * naming a score looks in all of them. The transport's `sync`, `rebase`, `rate`, `ramp` and
   * `seek` move it, and the mix's own throw. Its history is the transport's, so the mix takes no
   * `history` of its own.
   */
  transport?: Transport;
  /** What `Marked.mix` and errors call this mix. */
  name?: string;
}

/**
 * How sure a projection is of one channel: `exact` where only the clock and known changes drove
 * it; `stepped` where state was advanced across a gap in one go, which is as good as the patch's
 * step makes it, or a signal's state was read back from a copy; `held` where it depends on input from outside the clock, whose value at that time
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
   * Cues N voices into one role, their weights split from one signal, so they fold as
   * alternatives. The signal is read once per subject per frame, with the first member's setting,
   * and every member takes its share of that one reading, which `share` reads outside the blend; a
   * signal keeping state keeps it once, not per member. One `spec` cues them all, and a member given as a
   * `BlendMember` carries its own `name`, `tags` and `hits` in place of the spec's.
   */
  blend(
    // biome-ignore lint/suspicious/noExplicitAny: a patch naming no host fits a mix naming one
    members: readonly (Patch<I, O, any, H> | BlendMember<I, O, H>)[],
    by: Signal<I, H>,
    spec?: Omit<VoiceSpec<I, O, H>, 'patch' | 'weight' | 'role' | 'locus' | 'within'>,
  ): Handle<I>[];

  /**
   * Cues an owner: a voice with no patch that holds the voices cued with `owner` set to its handle,
   * and plays them on its own clock, so they can be placed, timed and faded as one. Its handle acts
   * on all of them: `rate` and `ramp` multiply into theirs, `seek` moves their clocks with its own
   * and rebuilds their state as it does a voice's, and `weight` and `fade()` multiply into their weights, by
   * what its `weightOf` reports; it fades as a whole, not by subject or at rest. It is
   * `played` once every voice it held has finished its passes, and leaves, `done`, with its last; a
   * fade that ends takes the rest with it. One that never holds a voice stays until faded. Owners
   * nest. Throws for a `loop`: a pass would have to restart its children.
   */
  owns(spec: OwnerSpec<I, H>): Handle<I>;
  /**
   * Cues a span: an owner that lays out the voices it holds in `order` and fits them into its
   * `duration`, again each time one joins or leaves early. A child's start and rate are the
   * span's to set, so it takes neither `start` nor an anchored start; its `SpanHints` say how it
   * may give way. A span with a budget stays until the budget has passed, though its children
   * finish sooner, so late ones can still join, and its `end` mark is where its children end or
   * its budget does, whichever is later. A voice that loops for good cannot join one. Throws for
   * a `rate` below 0: a span lays its children out forward from its start, and its handle's `rate`
   * turns it once it plays.
   */
  span(spec: SpanSpec<I, H>): SpanHandle<I>;
  /**
   * Cues an arc: an owner holding three parts that hand over in order on its clock, `enter`, then
   * `active` for the `hold`, then `exit`, each a voice or several layered. Its marks are its own:
   * `start` as the enter begins, `in` as it ends, `coast` as the hold ends and `out` as the exit
   * begins, which are one time, and `end` as the exit ends, where it leaves and `done` resolves.
   * While the hold is open, `coast`, `out` and `end` are unknown until `release` fixes them. Each
   * part shows its first and last frames through the blends either side of it, and a part left
   * out leaves its time to the one before it. Its `fade` takes it out with no exit. An arc with a
   * finite hold may sit in a span. Throws for a `rate` below 0, a hold below 0, and an `enter` or
   * `exit` that never ends.
   */
  arc(spec: ArcSpec<I, O, H>): ArcHandle<I>;

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
   * reads by `pull`. An array `out` already holds for a `vec` channel, a `quat` that
   * runs on a lane, or a `color` that averages in OKLab or runs on a lane, is written in place where it is the channel's length, so a host that
   * kept one from an earlier probe into the same `out` sees it change: copy what has to outlast the
   * next probe.
   */
  probe(subject: I, out?: O): O;
  /**
   * A new empty pose, each call its own object, holding every channel with a rest in kit order: a
   * number rest at its value, any other `undefined` until a probe writes it. Make one and pass it
   * as `probe`'s `out` every frame. An `out` made as `{}` or a literal shares V8's shapes with the
   * host's other small objects, which can leave each number written into it boxed; this one has a
   * shape of its own, so the mix writes numbers into it without allocating.
   */
  pose(): O;
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
   * Reads the mix at another mix time, without moving it. At the mix's own time it reads what
   * `probe` does: what the host has done since the last sync lands at the next. Ahead of the mix
   * it plays what is cued forward, with the calls the tape holds after a `seek` back, and while a
   * voice could carry state (a patch that steps, a signal weight) it reads each subject asked about
   * at every known event on the way: each call, and each mark `marks` would list. It throws
   * for the two a copy cannot take: a `drop` of a subject a motion patch holds, and a retarget or
   * push made before its voice met the subject. Behind it, with `history`, it reads the last frame at or before `time`
   * as that frame showed, and throws for a time older than the history reaches. On a transport it
   * reads every mix on it together, so anchors across them answer.
   *
   * Without `history` it reads back only where how the mix stands now says what it showed then,
   * and throws otherwise, saying why. Every voice has to play as it was cued and read by its clock
   * alone: no state, motion, `from: 'current'`, anchor or owner, no write to its handle, and no channel without a rest
   * at a weight that moves. The mix's rate has never been set. And `time` is no earlier than the
   * last cue, `drop`, `touch`, `announce` or `rebase`, or the last frame a voice left in.
   *
   * Given `{ frame }`, a number `seq` read, it reads that frame as it showed, as `seek` does; it
   * needs `history`.
   */
  project(at: number | { readonly frame: number }): Projection<I, O>;
  /**
   * Moves the mix to mix time `time`, as it stood at the end of that frame, and plays on from
   * there; where rate 0 held the clock at `time` for several frames, the last of them. Needs
   * `history` with a `tape`, which records the host's calls by the host time they were made at.
   *
   * Back, the mix restores itself: controls, records, voices and marks as they stood then. Voices
   * that left after it are back on the handles the host holds, their `done` and `played` starting
   * over where they had settled since. Voices cued after it wait as `pending` until the mix plays
   * their cue again, and a write to the handle of one waiting changes nothing. Stateful voices
   * restart from the copy `history` kept nearest before it and step once to it, exact under
   * `stepMs`. A subject faded out of a voice or dropped after it comes back with the record it
   * had, a motion patch's state included. Recorded input and host fields after it are let go:
   * after a seek back, signals and host fields read live again, and `assess` reports what they
   * fed as `held`.
   *
   * Forward, through a sync or a later seek, the mix plays the recorded calls again in the frames
   * they were made in: cues, handle writes, fades, retargets and pushes, its rate, marks,
   * `mute` and `drop`. A call the host makes while there are recorded calls ahead starts a new
   * branch, and the tape keeps the old future beside it; `tape.switchBranch` picks one back.
   * Playing past a time again sends its events and books its marks and hits again.
   *
   * The host goes on passing its own clock: the next `sync` reads the moment sought plus the
   * host's time since its last sync. Throws for a time older than history reaches, and before
   * the first sync. With a history `store`, a time older than memory needs `prepare` first, or
   * throws `HistoryMiss` before anything moves.
   *
   * Given `{ frame }`, a number `seq` read, it moves to the end of that frame instead, which is
   * how a host reaches an earlier one of several frames rate 0 held at one mix time. The frame has
   * to be one history still holds: not let go with age, and not after a moment an earlier seek went
   * back to. With a store, one older than memory needs `prepare` of its mix time first.
   */
  seek(to: number | { readonly frame: number }): void;
  /** As `Transport.prepare`, for a mix made alone. */
  prepare(time: number): Promise<void>;
  /**
   * The mix clock at the last sync or seek, which `seek` and `project` take; NaN before the first
   * sync. Host time at the mix's rate, less what `rebase` took out and `seek` moved.
   */
  readonly now: number;
  /** The host's timestamp at the last sync; NaN before the first. */
  readonly timestamp: number;
  /**
   * The number of the frame being played, which `seek({ frame })` and `project({ frame })` take:
   * each sync and seek begins a frame with a higher one, so two frames at one mix time differ.
   */
  readonly seq: number;
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
   * since the last sync, a retarget or a rate included, makes it false until the next. Read as true,
   * it tells the mix the host may sleep: a voice cued with no `start` before the next sync starts
   * at that sync.
   */
  readonly inert: boolean;
  /**
   * Calls `fn` when a host call makes the mix need frames again after a sync: a cue, a fade, a
   * handle's or the mix's rate, a seek, a `drop`, a motion retargeted. It fires once until the next
   * sync clears the change, and never during `sync`. Returns a function that unsubscribes `fn`.
   * A frame loop sleeping on `inert` subscribes here to wake.
   */
  onWake(fn: () => void): () => void;
  /**
   * Takes the mix off the list debuggers read (see `watched`), for a host done with it, where it
   * would otherwise stay until collected. Stops every watcher, and frees a hold no other listed mix
   * on its transport shares. It still plays if synced.
   */
  close(): void;
  /** Fades every voice out: over `over` when given, over each voice's own `fade.out` otherwise. */
  mute(opts?: { over?: number }): void;
  /**
   * Forgets per-subject state, a motion patch's for the subject included, and any fade of the
   * subject out of a voice, so nothing keeps the subject alive.
   */
  drop(subject: I): void;
  /**
   * Says that something a patch reads from outside the mix has changed since the last sync, such as
   * a table its `at` looks a subject up in, so the next probe calls the patch again where it would
   * have answered with what it read this frame. Given a subject, for that subject only; with none,
   * for every subject. The clock stays where it is and no `step` runs again, and it wakes a frame
   * loop sleeping on `inert`, as any change does.
   */
  touch(subject?: I): void;
  /**
   * Gives the mix each subject's position, for voices cued `within` a circle: `xy` holds two numbers
   * a subject, `x` then `y`, in the order of `subjects`. It is read in place, so a host moving its
   * subjects writes into it and calls `moved`. `cell` sizes the grid the mix finds subjects in,
   * best near the radius the circles use; by default, about two subjects a cell. Another call
   * replaces the list. Subjects are held as the mix holds every subject: an object weakly, anything
   * else until `drop`, which also takes its position away until the next `plot`. Throws for an `xy`
   * shorter than two numbers a subject.
   */
  plot(subjects: readonly I[], xy: Float64Array, cell?: number): void;
  /** The host wrote new positions into the array it gave `plot`, which the next frame reads. */
  moved(): void;
  /**
   * Moves one plotted subject to (`x`, `y`), for a host where few move at once: it writes into the
   * array `plot` was given, so the host's array holds the move too, and the grid is built again
   * only once many subjects have left their cells. The same as writing the array and calling
   * `moved`; the two mix freely. Throws for a subject `plot` was not given, or one dropped since.
   */
  put(subject: I, x: number, y: number): void;
  /**
   * A weight signal over the positions `plot` gave: 1 at the circle's center, falling with distance
   * to 0 at `r` and beyond, along `ease` read from the edge (0) to the center (1), linear by
   * default. The host moves or resizes the circle by writing to it. A voice it weighs is bounded to
   * the circle as if cued `within` it, with no check, since the circle is the signal's own edge,
   * where the voice could take a `within`; elsewhere it plays unbounded, to the same values. A
   * subject with no position reads 0.
   */
  around(circle: Circle, opts?: { ease?: Easing }): Signal<I, H>;
  /**
   * Puts a named mark on a score, for anchors to target as they target a voice's marks: a voice
   * placed `{ with: 'reply' }` waits until the host announces `reply`. `at` is a timestamp on the
   * host's clock, default now, and may lie ahead, so a read ahead sees it. A mark stays while it is
   * ahead or while the mix's history reaches it.
   */
  announce(name: string, opts?: { at?: number; score?: string; tags?: readonly string[] }): void;
  /**
   * Every mark the plan knows between two timestamps on the host's clock, earliest first: when
   * voices start, are fully in, end their last pass, begin to fade and are gone, and what the host
   * announced. A mark
   * nothing has fixed yet, such as the out of a voice that loops for good, is not listed.
   */
  marks(from: number, to: number): Marked[];
  /**
   * Every event patches have sent since the last drain, earliest first, in the order they were sent
   * where two share a timestamp. A subject's events are made while it catches up, which is when it is
   * probed, so one nobody probes has sent nothing yet: promptness is the host's, by probing. A
   * stateless patch's `at` on a lane is the exception: it runs at the frame's first probe for every
   * subject probed that frame or the last. Under `stepMs` each carries the end of the interval it happened in, so
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
  book<E = unknown>(opts: BookOptions<E, I>): Booker;
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
