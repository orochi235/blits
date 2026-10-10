import type { Blend } from './blend.js';
import { type Clock, elapsedWith, passesOf, rateWith, rebaseWith, timeWith } from './clock.js';
import { type Curve, curve } from './easing.js';
import type { Leavings } from './leavings.js';
import { motionOf } from './motion.js';
import type { Motions } from './motions.js';
import { Named } from './named.js';
import type { Past } from './origin.js';
import { childPlayed, Holding, mixTime, ownedElapsed, ownerPatch } from './owner.js';
import { type Built, builtOf, durationOf, intosOf, type Scratch } from './patch.js';
import { reading } from './reading.js';
import type { Fitting } from './spans.js';
import { Store } from './store.js';
import type { Anchor, Channel, FadeSpec, Handle, Patch, Setting, VoiceSpec } from './types.js';

/**
 * A subject's record as it left a voice, faded out of it or dropped: the mix time and frame it
 * left at, and `sync` where the frame's sync made it, before the frame was read.
 */
export interface Left<I> {
  subject: I;
  at: number;
  seq: number;
  sync: boolean;
  held: Subject<unknown>;
}

export const none: readonly string[] = Object.freeze([]);

/** Everything one voice holds for one subject, chained through the next voice that reaches it. */
export interface Subject<S> {
  /** The voice's `target` answer, fixed on first sight. */
  reaches: boolean;
  /** The voice's `stagger` answer in voice ms, fixed on first sight. */
  delay: number;
  /** The mix timestamp this subject's delay ran out at, which its step grid counts from. */
  since: number;
  /** The mix timestamp its fade in counts from: `since`, or earlier for a voice freezing before. */
  shown: number;
  /** The weight this voice gave this subject the last frame it was probed, 0 where it gave none. */
  weight: number;
  /** Left at rest during a handover, so it stops contributing. */
  rested: boolean;
  /**
   * Per written channel, whether a rest-less contribution is on: 0 unknown, 1 on, 2 off; null until
   * a rest-less channel asks.
   */
  bands: Uint8Array | null;
  state: S;
  /** The `now` this subject last caught up to, for this voice. */
  stepped: number;
  /** Under `stepMs`, how many intervals have run since `since`; `stepped` is where that lands. */
  ticks: number;
  /** The `now` this subject was last probed at, so twelve probes in a frame step once. */
  probed: number;
  /** The last delta computed this frame, handed back to a repeat probe unchanged. */
  delta: Record<string, unknown> | null;
  /** The phase `delta` was read at, to read it again once its voice's scratch has moved on. */
  phase: number;
  /** The voice's `seeks` when `delta` was read, so a seek later in the frame reads it again. */
  seeks: number;
  /** The voice's `rebuilds` when its state was last made, so a seek's rebuild reaches it once. */
  rebuilt: number;
  /** Stop 0 for a `from: 'current'` voice, taken the first frame this subject is seen. */
  base?: Record<string, unknown>;
  /** The pose's velocity per channel at that moment, units per ms, so the first segment leaves at it. */
  slope?: Record<string, unknown>;
  /** What `setting.keep` holds for this voice and subject, by owner; null until it holds any. */
  kept: Map<object, unknown> | null;
  /** Kept state a history store gave back, which each owner takes in turn on its first keep. */
  unkept?: unknown[];
  /** Under `history`, copies of this record by the mix time they were taken, oldest first. */
  snaps?: { at: number; seq: number; held: Subject<S> }[];
  /** In a projection: where this record started from, and whether nothing known could be. */
  from?: number;
  unknown?: boolean;
  /** Under `history` with `inputs`, what an input weight signal read for this subject, when it changed. */
  inputs?: { at: number; seq: number; value: number }[];
  /** In a projection reading back: that record, to read in place of the signal. */
  replay?: { at: number; value: number }[];
  /** The voice this is the record of; null on a subject's stub. */
  voice: object | null;
  /** The next voice's record for this subject, in voice order, among those that reach it. */
  next: Subject<unknown> | null;
  /**
   * On the first record, which the mix keeps per subject so a probe makes one lookup: the `version`
   * the chain was linked at, and per locus, by channel slot, whether a rest-less contribution is on:
   * 0 never decided, 1 on, 2 off.
   */
  version: number;
  loci: Map<string, Uint8Array> | null;
  /** On the first record: the number lanes index this subject by, -1 without one. */
  slot: number;
}

/**
 * A voice's `setting.keep`, one per voice: a setting is valid only during its call, so the state
 * goes on the record of the subject being called for, `keepOn`, or on the voice before any is.
 */
function keeping<I, O>(voice: Voice<I, O>): Setting['keep'] {
  return function keep<K>(owner: object, init: () => K): K {
    const held = voice.keepOn;
    let kept = held === null ? voice.ownKept : held.kept;
    if (kept === null) {
      kept = new Map();
      if (held === null) voice.ownKept = kept;
      else held.kept = kept;
    }
    if (kept.has(owner)) return kept.get(owner) as K;
    const unkept = held?.unkept;
    const made = unkept === undefined ? init() : (unkept.shift() as K);
    if (unkept?.length === 0 && held !== null) held.unkept = undefined;
    kept.set(owner, made);
    reading.kept++;
    return made;
  };
}

/**
 * A voice's setting. `keep` is made on first read: most patches keep no state, and a closure and
 * its context per voice cost a one-subject tween voice about 100 bytes.
 */
class VoiceSetting<I, O> implements Setting<unknown> {
  timestamp = 0;
  dt = 0;
  elapsed = 0;
  pass = 0;
  weight = 0;
  state: unknown = undefined;
  private kept: Setting['keep'] | null = null;

  constructor(
    public host: unknown,
    readonly send: (event: unknown) => void,
    private readonly voice: Voice<I, O>,
  ) {}

  get keep(): Setting['keep'] {
    if (this.kept === null) this.kept = keeping(this.voice);
    return this.kept;
  }
}

/** A voice's clock, weight and fade from one mix time on, kept under `history`. */
export interface Controls extends Clock {
  at: number;
  /** The frame it was made in. */
  seq: number;
  weight: number;
  out: Ramp | null;
  back: Rise | null;
  /** Where its anchors had placed it then: start, and the start of an anchored fade out. */
  start: number;
  outAt: number;
  /** A fade the host set for `outAt`: its ramp, NaN for the voice's own `fade.out`. */
  outOver: number;
  outSet: boolean;
  rebuilds: number;
  /** How many of the voice's past clocks it had then. */
  past: number;
  /** Shows in its own frame: made by a sync, or before anything read the mix that frame. */
  sync: boolean;
}

/** A store that fills a missing entry from `make` on first ask. */
class Filled<K, V> extends Store<K, V> {
  constructor(private readonly make: (key: K) => V | undefined) {
    super();
  }

  override get(key: K): V | undefined {
    let v = super.get(key);
    if (v === undefined) {
      v = this.make(key);
      if (v !== undefined) super.set(key, v);
    }
    return v;
  }
}

const noSend = (): void => {};

export interface Ramp {
  from: number;
  at: number;
  over: number;
  rest: boolean;
  deadline?: number;
}

/**
 * A climb back from a fade out that was turned around: from `from`, the place along the fade's
 * curve it had reached, at mix time `at`, rising at the whole curve per `over` ms.
 */
export interface Rise {
  from: number;
  at: number;
  over: number;
}

export class Voice<I, O> {
  state: 'pending' | 'live' | 'frozen' | 'fading' | 'done' = 'pending';
  rate: number;
  weight: number;
  /**
   * elapsed = anchorElapsed + the rate integrated from anchorNow, rebased on a rate change or a seek.
   * Without a ramp the rate is constant; with one it moves linearly from `from` to `to` over `over`
   * mix ms starting at the anchor, and holds `to` after.
   */
  anchorNow: number;
  anchorElapsed = 0;
  ramp: { from: number; to: number; over: number } | null = null;
  out: Ramp | null = null;
  /** A fade out turned around, still climbing back; null once back in, or never turned. */
  back: Rise | null = null;
  subjects = new Store<I, Subject<unknown>>();
  /** The subjects its spec names, or null where it names none. */
  readonly named: Named<I> | null;
  /** Kit slot of each channel the patch writes, in `writes` order. */
  readonly slots: number[];
  /** The stops built ahead of time, for a `keys` patch. */
  readonly built: Built | null;
  /** The kit's `lerp` for each channel the patch writes, which keyed stops interpolate through. */
  readonly lerps: Channel<unknown>['lerp'][];
  /** Per keyed channel, the in-place form of the lerp its stops take, where it has one. */
  readonly intos: ReturnType<typeof intosOf> | undefined;
  /**
   * The arrays keyed reads interpolate into: one set for the voice, not one per subject, since 10k
   * subjects' worth of long-lived arrays costs more in cache misses than allocating them did.
   */
  scratch: Scratch = [];
  /** The record whose delta holds `scratch`'s arrays; any other's must be read again to be handed out. */
  holder: Subject<unknown> | null = null;
  /** Whether its channels run as lanes this frame, so the general fold passes it by. */
  laned = false;
  /**
   * How many times it has been sought or touched, so a delta read before either is not handed out
   * after it.
   */
  seeks = 0;
  /** Whether the host has written to its handle, so it no longer plays as it was cued. */
  written = false;
  /** How many of `seeks` were the mix's `touch`, which moves no clock. */
  touches = 0;
  /** How many times its clock has jumped, which a booker counts hits again from. */
  get jumps(): number {
    return this.seeks - this.touches;
  }
  /** Seeks that rebuild state; a record stamped with fewer makes its state again before stepping. */
  rebuilds = 0;
  /** Whether its span's last fit jumped it to its end, which leaves it no time in that fit. */
  skipped = false;
  /** Whether its patch has kept state on a record through `setting.keep`, which makes it stateful. */
  keeping = false;
  /** Subjects fading out of this voice alone, by the ramp each started; null while none are. */
  parts: Map<I, { at: number; over: number; seq: number }> | null = null;
  /** Subjects faded out of this voice, by the mix time and frame each left at; null while none have. */
  parted: Map<I, { at: number; seq: number }> | null = null;
  /**
   * Under history, the records of subjects that left this voice, by the mix time and frame each
   * left at, while a seek or a read back may reach them; null while none have.
   */
  left: Leavings<I> | null = null;
  readonly ease: Curve | undefined;
  /** How many passes its `loop` plays, worked out once. */
  readonly passes: number;
  readonly duration: number;
  /** Voice ms its passes last, Infinity for a patch with no passes or a loop for good. */
  readonly span: number;
  /** The state behind a motion patch, undefined for any other. */
  readonly motion: Motions<I> | undefined;
  /** Its `freeze`, for a patch it applies to: motion keeps its target already. */
  readonly freezesBefore: boolean;
  readonly freezesAfter: boolean;
  /** The mix time it first showed: when it was cued, or the first sync after. */
  opened = Number.NaN;
  /** Which of its entries in the mix's due queue is current; older ones are skipped when popped. */
  dueToken = 0;
  /**
   * Records whose `since` was still ahead when last worked out, which a later start, rate change
   * or seek moves; null while none are.
   */
  early: Subject<unknown>[] | null = null;
  /** The clocks it ran on before its current one, where a subject's origin may lie; null for none. */
  clocks: Past[] | null = null;
  /** Reused for every call this voice makes, so it is valid only during the call. */
  readonly setting: Setting<unknown>;
  /** Every subject this voice has been asked about, so a handover knows when it is finished. */
  seen = 0;
  /** The longest stagger of any subject seen, so a finite loop waits for the last of them. */
  latest = 0;
  restedCount = 0;
  /** The mix time it was cued at; -Infinity before the first sync. */
  cuedAt = Number.NEGATIVE_INFINITY;
  /** The frame it was cued in. */
  cuedSeq = Number.NEGATIVE_INFINITY;
  /** The mix time it left at, which a fade or seek given a time already passed puts behind now. */
  doneAt = Number.POSITIVE_INFINITY;
  /** The frame its leaving was decided in, which a seek or read back partitions by. */
  doneSeq = Number.POSITIVE_INFINITY;
  /** Under `history`, its controls after each change, oldest first. */
  log: Controls[] | null = null;
  /** Under `history`, its controls as `cue` left them, which a voice parked by a seek takes back. */
  first: Controls | null = null;
  /** Where an anchored `out` or `end` puts its fade's start, mix time; Infinity until known. */
  outAt = Number.POSITIVE_INFINITY;
  /** The ramp of a fade the host set for `outAt` with `fade({ at })`; NaN for the voice's own. */
  outOver = Number.NaN;
  /** Whether the host set `outAt` with `fade({ at })`, which no anchor moves. */
  outSet = false;
  /** The host time a pinned start was given at, NaN for none: a seek back pins it again. */
  pinned = Number.NaN;
  /** Whether its start is still to be fixed by an anchor, so it waits pending. */
  placing = false;
  /** What each member of a join last answered, kept for once its target has left. */
  answers: Map<Anchor, number> | null = null;
  /** What each of its anchors' queries has read of each mix's gone voices (`place.ts`'s `Fold`). */
  folds: Map<unknown, Map<unknown, unknown>> | null = null;
  /** The record `setting.keep` writes to: the one its patch or signal is being called for. */
  keepOn: Subject<unknown> | null = null;
  /** What `setting.keep` holds when called before any record is. */
  ownKept: Map<object, unknown> | null = null;
  /** The blend it is a member of, and which. */
  blend: { of: Blend<I, O>; i: number } | null = null;
  /** The one record of every subject it does not reach. */
  unreached: Subject<unknown> | null = null;
  /** By subject number, a bit set where `unreached` stands for the subject; null until one is. */
  unreachedBits: Uint32Array | null = null;
  /** Whether one record stands for every subject: see `shares` in `everyone.ts`. */
  sharing = false;
  /** That record, null until a chain first asks and once the voice shares no more. */
  everyone: Subject<unknown> | null = null;
  /** While sharing, by subject number: a bit where a chain has asked about the subject. */
  sighted: Uint32Array | null = null;
  /** While sharing, by subject number: the weight last given the subject on the general path. */
  weights: Float64Array | null = null;
  /**
   * While sharing a patch that is called, by subject number: when it was last called for the
   * subject and at what `seeks`, side by side, and the delta that call gave.
   */
  stamps: Float64Array | null = null;
  deltas: (Record<string, unknown> | null)[] | null = null;
  /** The handle `cue` returned, which `voices` hands back too. */
  handle: Handle<I> | null = null;
  /** With a history store, the key of every subject it has a record of; null without one. */
  keyed: Set<string | number | undefined> | null = null;
  /** For an owner, the voices it holds; null for any other voice. */
  holding: Holding<Voice<I, O>> | null;
  /** For a span, its budget and how its children were last fitted; null for any other voice. */
  fitting: Fitting | null = null;
  /**
   * `done` and `played`, made when first asked for, already settled if the voice is: most hosts
   * never await either, and a mix may hold tens of thousands of voices.
   */
  private finished = false;
  private playedAs: boolean | undefined = undefined;
  /** The mix time `played` was settled at. */
  private playedAt = Number.NaN;
  /** The frame `played` was settled in, so a seek back to before it can open it again. */
  private playedSeq = Number.NaN;
  private donePromise: Promise<void> | null = null;
  private doneSettle: (() => void) | null = null;
  private playedPromise: Promise<boolean> | null = null;
  private playedSettle: ((played: boolean) => void) | null = null;
  /** A projection's copy, which settles nothing. */
  private quiet = false;

  get done(): Promise<void> {
    if (this.donePromise === null)
      this.donePromise = this.finished
        ? Promise.resolve()
        : new Promise((r) => {
            this.doneSettle = r;
          });
    return this.donePromise;
  }

  get played(): Promise<boolean> {
    if (this.playedPromise === null) {
      const as = this.playedAs;
      this.playedPromise =
        as !== undefined
          ? Promise.resolve(as)
          : new Promise((r) => {
              this.playedSettle = r;
            });
    }
    return this.playedPromise;
  }

  /** The voice has left: `done` resolves. */
  resolve(): void {
    if (this.quiet || this.finished) return;
    this.finished = true;
    this.doneSettle?.();
  }

  /**
   * Its finite loop ended (true) or it left first (false), whichever comes first, noticed at mix
   * time `at`: `played` resolves.
   */
  play(played: boolean, at: number, seq: number): void {
    if (this.quiet || this.playedAs !== undefined) return;
    this.playedAs = played;
    this.playedAt = at;
    this.playedSeq = seq;
    this.playedSettle?.(played);
    if (played && this.owner !== null) childPlayed(this.owner, at, seq);
  }

  /** How `played` settled, and the mix time and frame it did; undefined while it has not. */
  get settled(): { played: boolean | undefined; at: number; seq: number } {
    return { played: this.playedAs, at: this.playedAt, seq: this.playedSeq };
  }

  /** Whether `played` settled true, which its owner counted. */
  get passed(): boolean {
    return this.playedAs === true;
  }

  /** Whether `played` settled false: it left before its last pass ended. */
  get unplayed(): boolean {
    return this.playedAs === false;
  }

  /**
   * A seek back to frame `seq`: `done` and `played`, where they settled after it, start over with
   * fresh promises. True where `played` had settled true, which its owner counted.
   */
  reopen(seq: number): boolean {
    let unplayed = false;
    if (this.playedAs !== undefined && !(this.playedSeq <= seq)) {
      unplayed = this.playedAs;
      this.playedAs = undefined;
      this.playedPromise = null;
      this.playedSettle = null;
    }
    if (this.finished && !(this.doneSeq <= seq)) {
      this.finished = false;
      this.donePromise = null;
      this.doneSettle = null;
    }
    return unplayed;
  }

  /** Takes on a set of controls: its clock, weight, fades and where its anchors put it. */
  take(c: Omit<Controls, 'at' | 'seq' | 'sync'>): void {
    this.anchorNow = c.anchorNow;
    this.anchorElapsed = c.anchorElapsed;
    this.rate = c.rate;
    this.ramp = c.ramp;
    this.weight = c.weight;
    this.out = c.out;
    this.back = c.back;
    this.start = c.start;
    this.outAt = c.outAt;
    this.outOver = c.outOver;
    this.outSet = c.outSet;
    this.rebuilds = c.rebuilds;
    const clocks = this.clocks;
    if (clocks !== null && clocks.length !== c.past)
      this.clocks = c.past === 0 ? null : clocks.slice(0, c.past);
  }

  /**
   * A seek back to before its cue: out of the mix, as `cue` left it, until the mix plays the cue
   * again. What it played since is forgotten, and `done` and `played` start over where they had
   * settled.
   */
  park(): void {
    this.reopen(Number.NEGATIVE_INFINITY);
    this.take(this.first as Controls);
    this.log = null;
    this.state = 'pending';
    this.subjects = new Store();
    this.scratch = [];
    this.holder = null;
    this.laned = false;
    this.seeks++;
    this.keeping = false;
    this.parts = null;
    this.parted = null;
    this.opened = Number.NaN;
    this.dueToken++;
    this.early = null;
    this.seen = 0;
    this.latest = 0;
    this.restedCount = 0;
    this.cuedAt = Number.NEGATIVE_INFINITY;
    this.cuedSeq = Number.NEGATIVE_INFINITY;
    this.doneAt = Number.POSITIVE_INFINITY;
    this.doneSeq = Number.POSITIVE_INFINITY;
    this.placing = false;
    this.answers = null;
    this.folds = null;
    this.keepOn = null;
    this.ownKept = null;
    this.unreached = null;
    this.unreachedBits = null;
    this.sharing = false;
    this.everyone = null;
    this.sighted = null;
    this.weights = null;
    this.stamps = null;
    this.deltas = null;
    if (this.holding !== null) this.holding = new Holding();
  }

  constructor(
    readonly id: number,
    readonly spec: VoiceSpec<I, O>,
    readonly patch: Patch<I, O, unknown>,
    readonly fade: FadeSpec,
    now: number,
    public start: number,
    slotOf: Map<string, number>,
    channels: readonly Channel<unknown>[],
    host: unknown,
    send: (event: unknown) => void,
    /** The owner whose clock it runs on, its start included; null for one on the mix clock. */
    public owner: Voice<I, O> | null,
  ) {
    this.holding = patch === ownerPatch ? new Holding() : null;
    this.slots = patch.writes.map((k) => slotOf.get(k as string) as number);
    this.named = spec.subjects ? new Named(spec.subjects) : null;
    this.built = patch.form === 'keys' && patch.keys ? builtOf(patch) : null;
    this.lerps = this.slots.map((slot) => (channels[slot] as Channel<unknown>).lerp);
    this.intos = this.built
      ? intosOf(
          this.built,
          this.slots.map((slot) => channels[slot] as Channel<unknown>),
        )
      : undefined;
    this.ease = fade.ease === undefined ? undefined : curve(fade.ease);
    this.passes = passesOf(spec.loop);
    this.duration = durationOf(patch);
    this.span =
      this.duration > 0 && Number.isFinite(this.passes)
        ? this.duration * this.passes
        : Number.POSITIVE_INFINITY;
    this.motion = motionOf<I>(patch);
    const freezes = this.motion === undefined ? (spec.freeze ?? spec.hold) : undefined;
    // A voice with no freeze of its own takes its owner's.
    const inherits = freezes === undefined && this.motion === undefined && owner !== null;
    this.freezesBefore = inherits
      ? owner.freezesBefore
      : freezes === 'before' || freezes === 'both';
    this.freezesAfter = inherits ? owner.freezesAfter : freezes === 'after' || freezes === 'both';
    this.setting = new VoiceSetting(host, send, this);
    this.rate = spec.rate ?? 1;
    this.weight = typeof spec.weight === 'number' ? spec.weight : 1;
    this.anchorNow = start;
    if (now >= start) this.state = 'live';
  }

  /** What its clock reads at mix time `now`, through its owners' clocks. */
  elapsedAt(now: number): number {
    return this.owner === null ? elapsedWith(this, now) : ownedElapsed(this, this.owner, now);
  }

  /** The mix time its clock reads `elapsed`, inverting `elapsedAt`; Infinity where it never will. */
  timeAt(elapsed: number): number {
    const t = timeWith(this, elapsed);
    return this.owner === null ? t : mixTime(this.owner, t);
  }

  /** Records this voice's controls as they stand, from mix time `at` in frame `seq`. */
  note(at: number, seq: number, sync = false): void {
    this.log?.push({
      at,
      seq,
      sync,
      anchorNow: this.anchorNow,
      anchorElapsed: this.anchorElapsed,
      rate: this.rate,
      ramp: this.ramp,
      weight: this.weight,
      out: this.out,
      back: this.back,
      start: this.start,
      outAt: this.outAt,
      outOver: this.outOver,
      outSet: this.outSet,
      rebuilds: this.rebuilds,
      past: this.clocks?.length ?? 0,
    });
  }

  /**
   * A copy for a projection: its own setting, which sends nothing, and its own per-subject records,
   * filled from `fill`. With `controls` it takes those, as the voice stood at an earlier time. With
   * `share`, a voice keeping one record for every subject gives its copy a copy of that one, which
   * a read ahead starts every subject from; `fill` then serves only a copy that shares no more.
   */
  copy(
    fill: (subject: I) => Subject<unknown> | undefined,
    controls?: Controls,
    share = false,
  ): Voice<I, O> {
    // A literal keeps the copy in fast mode, where `Object.assign` left it a dictionary that every
    // read in a projection looked up by name.
    const v = { __proto__: Voice.prototype, ...this } as unknown as Voice<I, O>;
    const w = v as unknown as Record<string, unknown>;
    w.subjects = new Filled<I, Subject<unknown>>(fill);
    w.setting = { ...this.setting, keep: keeping(v), send: noSend };
    v.keepOn = null;
    v.ownKept = null;
    v.scratch = [];
    v.holder = null;
    v.laned = false;
    v.log = null;
    v.early = null;
    if (controls) v.take(controls);
    if (v.clocks === this.clocks && v.clocks !== null) v.clocks = v.clocks.slice();
    v.quiet = true;
    v.unreached = null;
    v.unreachedBits = null;
    const all = share && this.sharing ? this.everyone : null;
    v.sharing = all !== null;
    // Its delta is the live voice's to write into, and a keys voice's is in the live scratch.
    v.everyone =
      all === null ? null : { ...all, delta: null, probed: Number.NaN, from: all.stepped };
    v.sighted = null;
    v.weights = null;
    v.stamps = null;
    v.deltas = null;
    return v;
  }

  rateAt(now: number): number {
    return rateWith(this, now);
  }

  /** Moves the anchor to `now`, carrying what is left of a ramp. */
  rebase(now: number): void {
    rebaseWith(this, now);
  }
}
