import type { Arc } from './arcs.js';
import type { Blend } from './blend.js';
import type { Bound } from './bound.js';
import {
  backWith,
  type Clock,
  elapsedWith,
  frozenTime,
  passesOf,
  rateWith,
  rebaseWith,
  timeWith,
} from './clock.js';
import { type Curve, curve } from './easing.js';
import type { Leavings } from './leavings.js';
import { motionOf } from './motion.js';
import type { Motions } from './motions.js';
import { Named } from './named.js';
import type { Past } from './origin.js';
import {
  childPlayed,
  Holding,
  mixTime,
  ownedElapsed,
  ownerPatch,
  ownerReading,
  plays,
  turnedBack,
} from './owner.js';
import { type Built, builtOf, intosOf, type Scratch } from './patch.js';
import type { Seat } from './seat.js';
import { keeping, VoiceSetting } from './setting.js';
import { type Fitting, lingers } from './spans.js';
import { Filled, Store } from './store.js';
import type { Parted, Parting, Snap, Subject } from './subject.js';
import type { Anchor, Channel, FadeSpec, FitResult, Handle, Patch, VoiceSpec } from './types.js';
import { warnOnce } from './warn.js';

export const none: readonly string[] = Object.freeze([]);

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
  /** An arc's hold. */
  hold: number;
  /** How many of the voice's past clocks it had then. */
  past: number;
  /** The clocks a fit replaced; absent from a store written before a voice kept them. */
  earlier?: Earlier | null;
  /** The clocks its owner ran back before; absent from a store written before a voice kept them. */
  later?: Earlier | null;
  /** A span's end and how its fit came out; absent for any other voice. */
  fitted?: { end: number; report: FitResult } | null;
  /** Shows in its own frame: made by a sync, or before anything read the mix that frame. */
  sync: boolean;
}

/**
 * A clock a fit replaced, which its voice runs on again where its owner's clock runs back to
 * before the one that replaced it, with whether the fit had skipped it; `prev` is the one before.
 * In `later`, one its owner ran back before, taken again where the owner's clock reaches it.
 */
export interface Earlier extends Clock {
  readonly skipped: boolean;
  readonly prev: Earlier | null;
}

const noSend = (): void => {};

interface Writing {
  readonly slots: number[];
  readonly lerps: Channel<unknown>['lerp'][];
}

/** By a mix's `slotOf`, the slots and lerps of a patch writing one channel, shared by its voices. */
const writings = new WeakMap<Map<string, number>, Map<string, Writing>>();

function writing(
  writes: readonly string[],
  slotOf: Map<string, number>,
  channels: readonly Channel<unknown>[],
): Writing {
  if (writes.length !== 1) return written(writes, slotOf, channels);
  let known = writings.get(slotOf);
  if (known === undefined) {
    known = new Map();
    writings.set(slotOf, known);
  }
  const key = writes[0] as string;
  let found = known.get(key);
  if (found === undefined) {
    found = written(writes, slotOf, channels);
    known.set(key, found);
  }
  return found;
}

function written(
  writes: readonly string[],
  slotOf: Map<string, number>,
  channels: readonly Channel<unknown>[],
): Writing {
  const slots = writes.map((k) => slotOf.get(k) as number);
  return { slots, lerps: slots.map((slot) => (channels[slot] as Channel<unknown>).lerp) };
}

export interface Ramp {
  from: number;
  at: number;
  over: number;
  rest: boolean;
  deadline?: number;
  /** Begun where the voice ran back to its start, whose first frame it holds through the fade. */
  back?: boolean;
  /**
   * Begun where the passes of a voice an owner holds under history ran out: faded, it stays live
   * and quiet with its owner, which brings it back by taking its clock back into its passes.
   */
  stays?: boolean;
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
  /** Its crowd row, while its channels run in a crowd. */
  seat: Seat<I, O> | null = null;
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
  /** What its `earliest` answered at its span's last fit, span ms; NaN while unknown or absent. */
  floorSeen = Number.NaN;
  /** Whether its patch has kept state on a record through `setting.keep`, which makes it stateful. */
  keeping = false;
  /** Subjects fading out of this voice alone, by the ramp each started; null while none are. */
  parts: Map<I, Parting> | null = null;
  /**
   * Subjects faded out of this voice, by the mix time and frame each left at, and the ramp that
   * took it out, which a seek or a read back into it puts back; null while none have.
   */
  parted: Map<I, Parted> | null = null;
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
  /**
   * Whether it has no first pass: cued backward with no end to start from, it plays from 0 into
   * the pass before, so no time on its clock is before its start. Never a motion, whose stretches
   * begin at 0.
   */
  readonly beginless: boolean;
  /** Its `freeze`, for a patch it applies to: motion keeps its target already. */
  readonly freezesBefore: boolean;
  readonly freezesAfter: boolean;
  /** The mix time it first showed: when it was cued, or the first sync after. */
  opened = Number.NaN;
  /** Whether no delta its patch's `at` returned has been checked against `writes` yet. */
  unchecked = true;
  /** Which of its entries in the mix's due queue is current; older ones are skipped when popped. */
  dueToken = 0;
  /**
   * Records whose `since` was still ahead when last worked out, which a later start, rate change
   * or seek moves; null while none are.
   */
  early: Subject<unknown>[] | null = null;
  /** The clocks it ran on before its current one, where a subject's origin may lie; null for none. */
  clocks: Past[] | null = null;
  /** The clocks a fit replaced, latest first; null for none. */
  earlier: Earlier | null = null;
  /** The clocks its owner's clock ran back before, which it takes again going forward, soonest first. */
  later: Earlier | null = null;
  /** Reused for every call this voice makes, so it is valid only during the call. */
  readonly setting: VoiceSetting<I, O>;
  /** Every subject this voice has been asked about, so a handover knows when it is finished. */
  seen = 0;
  /** The longest stagger of any subject seen, so a finite loop waits for the last of them. */
  latest = 0;
  /** The least stagger of any subject seen, 0 or below, which a voice running back ends at. */
  soonest = 0;
  restedCount = 0;
  /** Whether a seek back to before its cue has it out of the mix, until the mix plays the cue again. */
  parked = false;
  /** The mix time it was cued at; -Infinity before the first sync. */
  cuedAt = Number.NEGATIVE_INFINITY;
  /** The frame it was cued in. */
  cuedSeq = Number.NEGATIVE_INFINITY;
  /** The mix time it left at, which a fade or seek given a time already passed puts behind now. */
  doneAt = Number.POSITIVE_INFINITY;
  /** The frame its leaving was decided in, which a seek or read back partitions by. */
  doneSeq = Number.POSITIVE_INFINITY;
  /** The mix time of that frame, later than `doneAt` for a leaving put behind now. */
  decidedAt = Number.NEGATIVE_INFINITY;

  /** The latest mix time a seek or read back to finds it still playing. */
  get reachedTo(): number {
    return this.doneAt > this.decidedAt ? this.doneAt : this.decidedAt;
  }
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
  /** The mix's offset when it was cued: a timestamp in its anchor converts at this one. */
  offset = 0;
  /** Cued with no start while its mix slept, so the next sync sets its start. */
  waking = false;
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
  /**
   * Copies the latest seek back cut from its records' lists that no other list holds, for the
   * copies its probes keep next to be written over; null until a seek cuts one.
   */
  spares: Snap<unknown>[] | null = null;
  /** The one record of every subject it does not reach. */
  unreached: Subject<unknown> | null = null;
  /** By subject number, a bit set where `unreached` stands for the subject; null until one is. */
  unreachedBits: Uint32Array | null = null;
  /** Whether one record stands for every subject: see `shares` in `everyone.ts`. */
  sharing = false;
  /** Where its signal is declared 0, its cue's `within`, so it is not read there: see `bound.ts`. */
  bound: Bound<I, O> | null = null;
  /** The frames it has played sharing it. */
  shared = 0;
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
  /** For an arc, how its parts are laid out; null for any other voice. */
  arc: Arc | null = null;
  /** For an arc, how long its hold lasts, ms on its clock: Infinity while open. */
  hold = 0;
  /** For a voice an arc holds, which part it plays: 0 enter, 1 active, 2 exit; -1 for any other. */
  part = -1;
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
    this.hold = c.hold;
    this.earlier = c.earlier ?? null;
    this.later = c.later ?? null;
    const fitted = c.fitted;
    if (fitted && this.fitting !== null) {
      this.fitting.end = fitted.end;
      this.fitting.report = fitted.report;
    }
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
    this.parked = true;
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
    this.latest = this.named?.latest ?? 0;
    this.soonest = this.named?.soonest ?? 0;
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
    const wrote = writing(patch.writes as readonly string[], slotOf, channels);
    this.slots = wrote.slots;
    this.named = spec.subjects ? new Named(spec.subjects, spec.stagger) : null;
    // Every subject's stagger is known at cue, so a finite loop ends by them all, read or not.
    this.latest = this.named?.latest ?? 0;
    this.soonest = this.named?.soonest ?? 0;
    this.built = patch.form === 'keys' && patch.keys ? builtOf(patch) : null;
    this.lerps = wrote.lerps;
    this.intos = this.built
      ? intosOf(
          this.built,
          this.slots.map((slot) => channels[slot] as Channel<unknown>),
        )
      : undefined;
    this.ease = fade.ease === undefined ? undefined : curve(fade.ease);
    this.passes = passesOf(spec.loop);
    this.duration = patch.duration;
    this.span =
      this.duration > 0 && Number.isFinite(this.passes)
        ? this.duration * this.passes
        : Number.POSITIVE_INFINITY;
    this.motion = motionOf<I>(patch);
    const freezes = this.motion === undefined ? spec.freeze : undefined;
    // A voice with no freeze of its own takes its owner's.
    const inherits = freezes === undefined && this.motion === undefined && owner !== null;
    this.freezesBefore = inherits
      ? owner.freezesBefore
      : freezes === 'before' || freezes === 'both';
    this.freezesAfter = inherits ? owner.freezesAfter : freezes === 'after' || freezes === 'both';
    this.setting = new VoiceSetting(host, send, this);
    this.rate = spec.rate ?? 1;
    this.weight = typeof spec.weight === 'number' ? spec.weight : 1;
    const endless = !Number.isFinite(this.span);
    this.beginless = this.rate < 0 && endless && this.motion === undefined;
    this.anchorNow = start;
    // Where it starts: a voice cued backward at its end, where it has one.
    this.anchorElapsed = spec.seek ?? (this.rate < 0 && !endless ? this.span : 0);
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

  /**
   * Whether its clock runs back by its controls: at a rate below 0, or on a ramp between rates
   * neither of which is above it. A ramp through 0 says neither way until it has turned.
   */
  get backs(): boolean {
    const r = this.ramp;
    return r === null ? this.rate < 0 : r.from <= 0 && r.to <= 0 && (r.from < 0 || r.to < 0);
  }

  /** Whether its ramp takes its rate through 0, which turns its clock around partway. */
  get turns(): boolean {
    const r = this.ramp;
    return r !== null && r.from * r.to < 0;
  }

  /**
   * The mix time its passes run out by its controls now: its last pass's end running forward, its
   * first pass's start running back. Infinity where they never do, and while a ramp has yet to
   * turn it around.
   */
  endsAt(): number {
    if (this.turns) return Number.POSITIVE_INFINITY;
    const backs = this.backs;
    let to: number;
    if (backs !== (this.owner !== null && turnedBack(this))) {
      if (this.beginless) return Number.POSITIVE_INFINITY;
      to = this.soonest;
    } else {
      if (!Number.isFinite(this.span)) return Number.POSITIVE_INFINITY;
      to = this.span + this.latest;
    }
    return this.reaches(to);
  }

  /** The mix time its clock reads `elapsed`, by its controls now, through every owner above it. */
  reaches(elapsed: number): number {
    const t = this.backs ? backWith(this, elapsed) : timeWith(this, elapsed);
    return this.owner === null ? t : mixTime(this.owner, t);
  }

  /**
   * Its state at mix time `t`, from its clock and fade, once every clock above it is back where it
   * was: a fade begins at once, even one whose ramp starts later, at the voice's start, and one
   * from where an owner under history keeps it ends with it quiet and live.
   */
  stateAt(t: number): Voice<I, O>['state'] {
    const out = this.out;
    if (out !== null) return out.stays && t >= out.at + out.over ? 'live' : 'fading';
    if ((this.owner === null ? t : ownerReading(this.owner, t)) < this.start) return 'pending';
    if (this.freezesAfter && this.elapsedAt(t) >= this.span + this.latest) return 'frozen';
    return 'live';
  }

  /**
   * Whether it is kept quiet past its passes at mix time `now`: its passes ran out while an owner
   * held it under history, and its clock has not come back into them. At their very edge it is
   * quiet unless its clock runs into them.
   */
  quietAt(now: number): boolean {
    const out = this.out;
    if (this.state !== 'live' || out?.stays !== true) return false;
    // An owner kept quiet while its children were, rather than run back to its start.
    if (this.holding !== null && out.back !== true) return !plays(this, now) && !lingers(this, now);
    // A fit that skipped it put it at its end at its start, so before its start it plays nothing.
    if (this.skipped && ownerReading(this.owner as Voice<I, O>, now) < this.start) return true;
    const at = this.elapsedAt(now);
    const end = this.span + this.latest;
    const back = this.backs !== (this.owner !== null && turnedBack(this));
    if (at > end || (at === end && !back)) return true;
    return !this.beginless && (at < this.soonest || (at === this.soonest && back));
  }

  /**
   * The mix time its clock ran back to `elapsed` by `now`, by its controls now: where a subject
   * `elapsed` into it reached its start. NaN where it has not, and for a voice an owner holds.
   */
  ranBackTo(elapsed: number, now: number): number {
    if (this.beginless || !this.backs || this.owner !== null) return Number.NaN;
    const t = backWith(this, elapsed);
    return t >= this.anchorNow && t <= now ? t : Number.NaN;
  }

  /** Whether it has yet to start at mix time `now`: pending, or fading out from before its start. */
  unstarted(now: number): boolean {
    const state = this.state;
    if (state === 'pending') return true;
    if (state !== 'fading') return false;
    return !((this.owner === null ? now : ownerReading(this.owner, now)) >= this.start);
  }

  /**
   * A subject's voice time at mix time `now`, `delay` into the voice, before its freezes apply. A
   * voice yet to start reads where it will: its clock is anchored there, and read at any time
   * before would have a voice sought ahead, or running back, play before its start.
   */
  rawAt(now: number, delay: number): number {
    return (this.unstarted(now) ? this.anchorElapsed : this.elapsedAt(now)) - delay;
  }

  /**
   * Whether a subject at `raw` is before its start at mix time `now`: it shows nothing, or its
   * first frame frozen.
   */
  before(raw: number, now: number): boolean {
    // Not `raw < 0`: see `frozenTime` for the clock that reads NaN before its start.
    return (!(raw >= 0) && !this.beginless) || this.unstarted(now);
  }

  /**
   * Whether a subject before its start shows its first frame: the voice freezes before, or is
   * fading out from where it ran back to its start, as one fading from its end shows its last.
   */
  get holdsFirst(): boolean {
    return this.freezesBefore || this.out?.back === true;
  }

  /**
   * Whether a subject past the end of its passes shows nothing: its clock runs back, so it has yet
   * to reach them, and it does not freeze after.
   */
  get hidesPast(): boolean {
    return !this.freezesAfter && this.backs !== (this.owner !== null && turnedBack(this));
  }

  /** A subject's voice time at `raw` once the voice's freezes apply; NaN where it shows nothing. */
  shownAt(raw: number): number {
    if (this.beginless) return raw;
    if (raw > this.span && this.hidesPast) return Number.NaN;
    return frozenTime(raw, this.holdsFirst, this.freezesAfter, this.span);
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
      hold: this.hold,
      past: this.clocks?.length ?? 0,
      earlier: this.earlier,
      later: this.later,
      fitted: this.fitting === null ? null : { end: this.fitting.end, report: this.fitting.report },
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
    v.seat = null;
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

/**
 * Warns, once a patch outside production, of a key the first delta `voice` read returns outside its
 * patch's `writes`, which the mix drops.
 */
export function checkWrites<I, O>(voice: Voice<I, O>, delta: object | null): void {
  voice.unchecked = false;
  if (delta === null || typeof delta !== 'object') return;
  const writes = voice.patch.writes as readonly PropertyKey[];
  for (const key in delta)
    if (!writes.includes(key))
      warnOnce(
        voice.patch,
        `${voice.spec.name ?? `voice ${voice.id}`}'s patch returns ${key} from at(), which is not in its writes, so the mix drops it`,
      );
}
