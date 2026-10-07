import { blended, blendOf, laneRead, shareKept } from './blend.js';
import type { Book } from './book.js';
import { aims, chain, linkable, relink } from './chain.js';
import { type LerpInto, lerpInto } from './channels.js';
import { cue } from './cue.js';
import type { Due } from './due.js';
import { beginFade, parting } from './fade.js';
import {
  apply,
  baseFor,
  clamp,
  fold,
  folded,
  foldLoci,
  foldWith,
  influence,
  isRest,
  type Key,
  keyed,
  linked,
  near,
  owedBy,
  passes,
  read,
  slopeFor,
  tick,
} from './fold.js';
import type { HandleHost } from './handle.js';
import { held, shownOf, sinceOf, unreachedOf } from './held.js';
import { book, laneHost } from './hosts.js';
import { Lanes } from './lanes.js';
import { foldLocus, type LocusScratch } from './locus.js';
import { listed } from './marks.js';
import type { MotionOwner, Motions } from './motion.js';
import { move, nextFrame, waits } from './move.js';
import { ownerPatch } from './owner.js';
import { Pace } from './pace.js';
import { pin } from './place.js';
import { project } from './project.js';
import { keep, pull } from './pull.js';
import { Steps } from './relink.js';
import { seek } from './seek.js';
import { Fitting, refit } from './spans.js';
import { Store } from './store.js';
import { record, replay, tapeOf } from './tape.js';
import type {
  Booker,
  BookOptions,
  Channel,
  Columns,
  Engine,
  Handle,
  Kit,
  Marked,
  Mix,
  MixOptions,
  OwnerSpec,
  Patch,
  Projection,
  Sent,
  Signal,
  SpanHandle,
  SpanSpec,
  Tape,
  VoiceSpec,
} from './types.js';
import { none, type Subject, type Voice } from './voice.js';
import {
  base,
  capped,
  fadeOf,
  horizonFor,
  ownedBy,
  ownerBase,
  prime,
  weigh,
  weighOwned,
} from './weigh.js';

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: every member of `Methods` is installed below
export class Mixer<I, O> implements Mix<I, O> {
  cued: Voice<I, O>[] = [];
  /** Under `history`, voices that have left but that a read back may still reach. */
  gone: Voice<I, O>[] = [];
  /** Set on a projection's own mixer: it sends nothing, keeps no history, and reads without committing. */
  projecting = false;
  /** Set on a projection reading back: a subject it has nothing on starts from its voice's start. */
  backward = false;
  /** True during a sync, so a control change it makes is recorded as showing in that frame. */
  moving = false;
  /**
   * Under `history` with `inputs`, the host fields patches read, copied each frame they changed. In
   * a projection reading back, the copy in force then.
   */
  hostLog: { at: number; fields: Record<string, unknown> }[] = [];
  /**
   * Marks the host announced on a score: `at` in host time, so the mix's rate never moves one, and
   * NaN until the next sync for one announced as now before any sync; `made` is the mix time it was
   * announced, for a read back to know what was known.
   */
  announced: {
    name: string;
    score: string | undefined;
    tags: readonly string[];
    at: number;
    made: number;
    order: number;
  }[] = [];
  hostThen: { fields: Record<string, unknown> } | undefined;
  /** Each subject's last two poses and when they were probed, for `from: 'current'`. */
  pose = new Store<I, { pose: O; at: number; prev: O | undefined; prevAt: number }>();
  nextId = 1;
  /**
   * The mix clock: host time at the mix's rate. Host time is the host's timestamp less every gap
   * `rebase` has taken out, `u` at the last sync.
   */
  now = Number.NaN;
  u = Number.NaN;
  /** This mix's frame among every mix's: moved by a sync, and by a control change or drop within one. */
  frame = nextFrame();
  offset = 0;
  /** The mix time of the first sync. */
  born = Number.NaN;
  /** Under `history.tape`, the host's calls by mix time, for `seek`. */
  readonly tape: Tape | undefined;
  /** True while the tape makes a recorded call again, so it is not recorded twice. */
  replaying = false;
  /** The mix's own rate; null while it has never been set, when mix time is host time. */
  pace: Pace | null = null;
  /** Pending voices whose start the host gave, by its host time, kept where the rate puts it. */
  pins: Map<Voice<I, O>, number> | null = null;
  last = Number.NaN;
  rebasing = false;
  wantsPose = false;
  /** The pose `pull` folds a subject into where it cannot read straight from the lanes. */
  scratch: O | undefined;
  /** The last array `pull` read, by position, with each subject's chain head, to skip the lookup. */
  /** Live voices by the earliest mix time `moveTo` would change each, a binary heap. */
  due: Due<I, O>[] = [];
  /** Voices retired since `moveTo` last pruned them, in the order they retired. */
  retired: Voice<I, O>[] = [];
  /** Visit every voice each sync, as before the due queue; for tests that compare the two. */
  walkAll = false;
  pulled: I[] = [];
  pulledHeads: (Subject<unknown> | undefined)[] = [];
  /** Each remembered head's lane slot, and the `version` and `relinks` they were all current at. */
  pulledSlots = new Int32Array(0);
  pulledVersion = Number.NaN;
  pulledRelinks = -1;
  /** Counts chains made stale one subject at a time, which `version` does not. */
  relinks = 0;
  /** Read once a sync, so a `reduce` function is not called per voice per subject. */
  reducedNow = false;
  /** Something was changed since the last sync, so the next frame may differ from this one. */
  stirred = false;
  /** Counts the changes `stir` records, which a frame's record of a probe is current only before. */
  stirs = 0;

  syncing = false;
  stirFns: (() => void)[] | null = null;

  /** Records a change to the mix's voices or controls. */
  stir(): void {
    this.stirs++;
    if (this.stirred) return;
    this.stirred = true;
    const fns = this.stirFns;
    if (fns !== null && !this.syncing) for (const fn of [...fns]) fn();
  }

  onWake(fn: () => void): () => void {
    if (this.stirFns === null) this.stirFns = [];
    const fns = this.stirFns;
    fns.push(fn);
    return () => {
      const i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
    };
  }
  /**
   * Per subject, the first record of the chain through every live voice that reaches it, or a stub
   * where none does. Relinked when `version` moves, which is whenever the list or a voice's pending
   * state changes.
   */
  chains = new Store<I, Subject<unknown>>();
  version = 0;
  readonly steps = new Steps<Voice<I, O>>();
  /** Per subject, the voices whose `subjects` name it, in voice order. */
  named = new Store<I, Voice<I, O>[]>();
  /** Voices a subject has been faded out of, which `drop` looks in besides those that reach it. */
  readonly parters = new Set<Voice<I, O>>();
  /**
   * Motion patches that may hold state for a subject no voice still reaching it plays, which `drop`
   * frees besides those voices' own: per subject, a patch a voice naming it left while another
   * voice plays on, or that the host retargeted it on; and any patch a voice over every subject
   * left while another plays on. How many live voices play each motion patch says which.
   */
  readonly strays = new Store<I, Motions<I>[]>();
  readonly strayAll = new Set<Motions<I>>();
  readonly playing = new Map<Motions<I>, number>();
  /** How many voices in the list carry `subjects`. */
  naming = 0;
  /** The voices in the list that name no subjects, in voice order. */
  general: Voice<I, O>[] = [];
  /** How many voices in the list carry a locus; with none, a fold allocates nothing. */
  loci = 0;
  /** What every motion patch it plays asks for its voice's time, holding this mix weakly. */
  owner: MotionOwner | null = null;
  /** How many voices in the list are anchored, so a sync with none skips placing them. */
  anchored = 0;
  /** Events sent since the last drain, and who is being probed, so `send` knows whose they are. */
  sent: Sent<I, unknown>[] = [];
  sending: { voice: Voice<I, O> | null; subject: I } = {
    voice: null,
    subject: undefined as I,
  };
  readonly send = (event: unknown): void => {
    const { voice, subject } = this.sending;
    if (voice === null || this.projecting || voice.setting.timestamp <= this.sentTo) return;
    this.sent.push({
      timestamp: voice.setting.timestamp,
      subject,
      voice: voice.id,
      tags: voice.spec.tags ?? none,
      event,
    });
  };
  /** The moment a seek went back to: what is stepped again up to it was sent the first time. */
  sentTo = Number.NEGATIVE_INFINITY;
  /** The weight `influence` found besides the delta, read by the caller at once. */
  w = 0;

  readonly names: Key<O>[];
  readonly channels: Channel<unknown>[];
  /** Slots of the channels that declare bounds, clamped after every fold. */
  readonly bounded: number[];
  /** By slot, a stock array channel's in-place `lerp`. */
  readonly lerpsInto: (LerpInto | undefined)[];
  /** What a fold with a locus in play gathers into, one per depth of folds under way. */
  readonly locusScratch: LocusScratch<I, O>[] = [];
  locusDepth = 0;
  readonly slotOf = new Map<string, number>();
  lanes: Lanes<I, O> | null;
  handles: HandleHost<I, O> | null = null;
  /** What `book` made, still booking; null while there is none. */
  bookers: Book<I, O>[] | null = null;
  /** The fit a span being cued takes, which `cue` hands its voice. */
  fitting: Fitting | null = null;
  /** Every owner still in the mix, null until one is cued. */
  owners: Voice<I, O>[] | null = null;

  constructor(
    readonly kit: Kit<O>,
    readonly opts: MixOptions,
  ) {
    this.names = Object.keys(kit as object) as Key<O>[];
    this.channels = this.names.map((k) => kit[k] as Channel<unknown>);
    this.bounded = this.channels.flatMap((c, i) => (c.bounds ? [i] : []));
    this.lerpsInto = this.channels.map((c) => lerpInto(c));
    this.names.forEach((k, i) => {
      this.slotOf.set(k, i);
    });
    this.lanes = opts.lanes === false ? null : new Lanes<I, O>(laneHost(this));
    this.tape = tapeOf(this);
  }

  get reduced(): boolean {
    const r = this.opts.reduce;
    return typeof r === 'function' ? r() : r === true;
  }

  get band(): { on: number; off: number } {
    return this.opts.band ?? { on: 0.6, off: 0.4 };
  }

  cue(spec: VoiceSpec<I, O>): Handle<I> {
    const engine = this.opts.engine ?? mixer;
    if (!engine.runs.has(spec.patch.form))
      throw new Error(`blits: engine ${engine.name} does not run ${spec.patch.form} patches`);
    return cue(this, spec);
  }

  blend(
    patches: readonly Patch<I, O, unknown>[],
    by: Signal<I>,
    spec: Omit<VoiceSpec<I, O>, 'patch' | 'weight' | 'locus'> = {},
  ): Handle<I>[] {
    const locus = `blend:${this.nextId}`;
    const of = blendOf<I, O>(by, patches.length - 1);
    return patches.map((patch, i) => {
      const handle = this.cue({ ...spec, patch, weight: by, locus });
      const voice = this.cued[this.cued.length - 1] as Voice<I, O>;
      voice.blend = { of, i };
      of.members.push(voice);
      return handle;
    });
  }

  owns(spec: OwnerSpec<I>): Handle<I> {
    if ((spec as { loop?: unknown }).loop !== undefined)
      throw new Error('blits: an owner does not loop: a pass would have to restart its children');
    return this.cue({ ...spec, patch: ownerPatch as Patch<I, O, unknown> });
  }

  span(spec: SpanSpec<I>): SpanHandle<I> {
    this.fitting = new Fitting(spec as SpanSpec<unknown>);
    try {
      const handle = this.owns(spec);
      refit(this, this.owners?.find((v) => v.handle === handle) as Voice<I, O>);
      return handle as SpanHandle<I>;
    } finally {
      this.fitting = null;
    }
  }

  sync(timestamp: number): void {
    this.syncing = true;
    try {
      this.syncAt(timestamp);
    } finally {
      this.syncing = false;
    }
  }

  private syncAt(timestamp: number): void {
    if (timestamp < this.last && !this.rebasing)
      throw new RangeError(
        `blits: sync went back from ${this.last} to ${timestamp}; the host's clock only goes forward, and seek moves the mix`,
      );
    if (this.rebasing && !Number.isNaN(this.last)) this.offset += timestamp - this.last;
    this.rebasing = false;
    this.last = timestamp;
    const u = timestamp - this.offset;
    let pace = this.pace;
    let now = pace === null ? u : pace.sync(u);
    const later = u !== this.u;
    const still = later && now === this.now;
    this.u = u;
    if (Number.isNaN(this.born)) this.born = now;
    // Calls the host made before, played again where a seek went back past them; one may set the
    // mix's rate, which moves where this sync lands.
    if (this.tape !== undefined && now > this.now) {
      const reading = () => (this.pace === null ? u : this.pace.reading(u));
      replay(this, reading);
      pace = this.pace;
      now = reading();
    }
    // Host time moving while the mix clock stands still lands what waits on host time or the host.
    if (now !== this.now || (later && pace !== null && waits(this))) move(this, now);
    const history = this.opts.history;
    if (this.tape !== undefined && history !== undefined) this.tape.prune(now - history.ms);
    // It is a frame too, which asks every weight signal again, so one reading input follows it.
    if (still) {
      this.frame = nextFrame();
      this.lanes?.refill();
    }
    const bookers = this.bookers;
    if (bookers !== null) for (const b of bookers) b.sync();
  }

  book(opts: BookOptions): Booker {
    return book(this, opts);
  }

  probe(subject: I, out?: O): O {
    const pose = this.fold(subject, out);
    this.keep(subject, pose, out);
    // Where the lanes answer `atRest` from their own values, there is nothing to keep.
    if (this.restStamps !== null && !(this.linkedLaned && this.restsLaned()))
      this.restStamps.set(subject, 2 * this.restsKey() + (this.rests(pose) ? 1 : 0));
    return pose;
  }

  pull(subjects: Iterable<I>, into: Columns<O>): void {
    pull(this, subjects, into);
  }

  seek(time: number): void {
    seek(this, time);
  }

  project(time: number): Projection<I, O> {
    const c = new Mixer<I, O>(this.kit, { ...this.opts, history: undefined, lanes: false });
    return project(this, c, time);
  }

  announce(
    name: string,
    opts: { at?: number; score?: string; tags?: readonly string[] } = {},
  ): void {
    const at = opts.at !== undefined ? opts.at - this.offset : this.u;
    const mark = {
      name,
      score: opts.score,
      tags: opts.tags ?? none,
      at,
      made: Number.isNaN(this.now) ? Number.NEGATIVE_INFINITY : this.now,
      order: this.nextId++,
    };
    this.announced.push(mark);
    record(this, 'announce', () => {
      this.announced.push({ ...mark });
    });
  }

  marks(from: number, to: number): Marked[] {
    return listed(this, from, to).map(({ order: _, ...m }) => m);
  }

  atRest(subject: I): boolean {
    this.restStamps ??= new Store<I, number>();
    const head = this.linked(subject);
    const laned = this.linkedLaned;
    const lanes = this.lanes as Lanes<I, O>;
    // Every voice on lanes and nothing to clamp: the pose a fold would make is the lanes' values.
    if (laned && this.restsLaned()) {
      const slot = (head as Subject<unknown>).slot;
      if (!lanes.owes(slot)) return lanes.rests(slot);
    }
    // A probe this frame answers for the pose it gave the host.
    const since = (this.restStamps.get(subject) ?? Number.NaN) - 2 * this.restsKey();
    if (since >= 0) return since === 1;
    this.restScratch ??= {} as O;
    const pose = this.foldWith(subject, this.restScratch, head, laned, true) as Record<
      string,
      unknown
    >;
    return this.rests((this.bounded.length === 0 ? pose : this.clamp(pose)) as O);
  }

  rests(pose: O): boolean {
    for (let i = 0; i < this.names.length; i++) {
      const channel = this.channels[i] as Channel<unknown>;
      const value = (pose as Record<string, unknown>)[this.names[i] as string];
      if (channel.rest === undefined) {
        if (value !== undefined) return false;
      } else if (!near(value, channel.rest)) return false;
    }
    return true;
  }

  rebase(): void {
    this.rebasing = true;
  }

  voices(tag?: string): Handle<I>[] {
    const out: Handle<I>[] = [];
    for (const voice of this.cued)
      if (voice.state !== 'done' && (tag === undefined || voice.spec.tags?.includes(tag)))
        out.push(voice.handle as Handle<I>);
    return out;
  }

  get live(): boolean {
    return this.cued.some((v) => v.state !== 'done');
  }

  get inert(): boolean {
    if (this.stirred) return false;
    // Standing still, a voice changes no pose but by its weight signal, or by an anchor or start
    // that host time may yet reach.
    if (this.pace?.stopped(this.u))
      return this.cued.every(
        (v) =>
          v.state === 'done' ||
          (v.state !== 'pending' &&
            typeof v.spec.weight !== 'function' &&
            v.spec.anchor === undefined),
      );
    return this.cued.every((v) => this.still(v, this.now));
  }

  get rate(): number {
    return this.pace === null ? 1 : this.pace.rateAt(this.u);
  }

  set rate(r: number) {
    this.ramp(r, 0);
  }

  ramp(rate: number, over: number): void {
    if (!(rate >= 0 && rate < Number.POSITIVE_INFINITY))
      throw new RangeError(`blits: a mix's rate is a finite number, 0 or more, not ${rate}`);
    if (this.pace === null) {
      this.pace = new Pace(this.opts.history !== undefined);
      // Until now mix time was host time, so a pending voice's start is the host time it was given.
      for (const v of this.cued)
        if (v.state === 'pending' && !v.placing && v.owner === null && v.spec.start !== undefined)
          pin(this, v, v.start);
    }
    const history = this.opts.history;
    const reach = history === undefined ? Number.NEGATIVE_INFINITY : this.now - history.ms;
    this.pace.change(this.u, rate, over, reach);
    this.stir();
    record(this, 'rate', () => this.ramp(rate, over));
  }

  /** Whether a voice will change no pose from `now` on, short of a change made to it. */
  still(voice: Voice<I, O>, now: number): boolean {
    if (voice.state === 'done') return true;
    if (voice.state !== 'frozen' && voice.state !== 'live') return false;
    if (typeof voice.spec.weight === 'function' || voice.parts !== null) return false;
    const fadeIn = this.reducedNow ? 0 : (voice.fade.in ?? 0);
    if (fadeIn > 0 && now - this.sinceOf(voice, voice.latest) < fadeIn) return false;
    if (voice.state === 'frozen' || voice.holding !== null) return true;
    const motion = voice.motion;
    return motion !== undefined && voice.elapsedAt(now) >= voice.latest && motion.landed();
  }

  mute(opts?: { over?: number }): void {
    for (const voice of this.cued) beginFade(this, voice, { over: opts?.over });
    record(this, 'mute', () => this.mute(opts));
  }

  drop(subject: I): void {
    this.frame = nextFrame();
    const head = this.chains.get(subject);
    // Nothing that kept this head, such as `pull`'s remembered list, may take it as current again.
    if (head !== undefined) {
      head.version = Number.NaN;
      this.relinks++;
    }
    if (head !== undefined && head.slot >= 0 && this.lanes !== null) this.lanes.release(head.slot);
    this.pose.delete(subject);
    this.restStamps?.delete(subject);
    this.chains.delete(subject);
    this.stir();
    // A record of it is only in a voice over every subject, one naming it, or one gone; a ramp out
    // of a voice that does not name it is in `parters`, and a patch's own state in `motions`.
    const forget = (voice: Voice<I, O>) => {
      voice.subjects.delete(subject);
      voice.motion?.release(subject);
      voice.parts?.delete(subject);
      voice.parted?.delete(subject);
      voice.blend?.of.reads.delete(subject);
    };
    for (const voice of this.general) forget(voice);
    const named = this.named.get(subject);
    if (named !== undefined) for (const voice of [...named]) forget(voice);
    for (const voice of this.gone) forget(voice);
    if (this.owners !== null) for (const voice of this.owners) forget(voice);
    for (const voice of this.parters) {
      forget(voice);
      if (voice.parts?.size === 0) voice.parts = null;
      if (voice.parted?.size === 0) voice.parted = null;
      if (voice.parts === null && voice.parted === null) this.parters.delete(voice);
    }
    const strays = this.strays.get(subject);
    if (strays !== undefined) for (const motion of strays) motion.release(subject);
    this.strays.delete(subject);
    for (const motion of this.strayAll) motion.release(subject);
    record(this, 'drop', () => this.drop(subject));
  }

  drain<E = unknown>(tag?: string): Sent<I, E>[] {
    const all = this.sent;
    if (all.length === 0) return [];
    let out = all;
    if (tag === undefined) this.sent = [];
    else {
      out = [];
      const kept: Sent<I, unknown>[] = [];
      for (const e of all) (e.tags.includes(tag) ? out : kept).push(e);
      this.sent = kept;
    }
    return out.sort((a, b) => a.timestamp - b.timestamp) as Sent<I, E>[];
  }

  /** Voices whose stop 0 is mid-computation, so a fold for one cannot re-enter itself. */
  readonly folding = new Set<number>();

  linkedLaned = false;
  /**
   * Per subject, twice `restsKey` at its last probe plus 1 if the pose rested; null until `atRest`
   * is first asked, when probes start writing it.
   */
  restStamps: Store<I, number> | null = null;
  /** What a probe's record of rest is good for: moved by a new frame, version or relink. */
  private restsEpoch = 0;
  private restsFrame = Number.NaN;
  private restsVersion = Number.NaN;
  private restsRelinks = -1;
  private restsStirs = -1;
  /** The pose `atRest` folds into where no probe this frame answers. */
  private restScratch: O | undefined;

  private restsLaned(): boolean {
    return (this.lanes as Lanes<I, O>).whole && this.bounded.length === 0;
  }

  private restsKey(): number {
    if (
      this.frame !== this.restsFrame ||
      this.version !== this.restsVersion ||
      this.relinks !== this.restsRelinks ||
      this.stirs !== this.restsStirs
    ) {
      this.restsEpoch++;
      this.restsFrame = this.frame;
      this.restsVersion = this.version;
      this.restsRelinks = this.relinks;
      this.restsStirs = this.stirs;
    }
    return this.restsEpoch;
  }
}

// The probe's hot path is methods, installed here from the modules that own them: as functions
// called directly they made probes and fills up to 9% slower (bench/ab.sh on teitou, 2026-10-05).
const methods = {
  fold,
  folded,
  linked,
  foldWith,
  owedBy,
  foldLoci,
  read,
  influence,
  keyed,
  tick,
  apply,
  clamp,
  passes,
  isRest,
  baseFor,
  slopeFor,
  prime,
  capped,
  horizonFor,
  weigh,
  weighOwned,
  base,
  envelope: fadeOf,
  ownedBy,
  ownerBase,
  blended,
  laneRead,
  shareKept,
  parting,
  chain,
  relink,
  linkable,
  aims,
  held,
  unreachedOf,
  sinceOf,
  shownOf,
  keep,
  foldLocus,
};
type Methods = typeof methods;
// biome-ignore lint/correctness/noUnusedVariables: merging needs the class's type parameters
export interface Mixer<I, O> extends Methods {}
for (const [name, value] of Object.entries(methods))
  Object.defineProperty(Mixer.prototype, name, { value, writable: true, configurable: true });

/**
 * The one that ships: every form on the CPU, probed per subject on demand.
 *
 * @category engine
 */
export const mixer: Engine = {
  name: 'mixer',
  runs: new Set<'fn' | 'keys' | 'motion'>(['fn', 'keys', 'motion']),
  create<I, O, H = unknown>(kit: Kit<O>, opts: MixOptions<H>): Mix<I, O, H> {
    return new Mixer<I, O>(kit, opts);
  },
};

/**
 * Makes a mix over a kit, on the engine the options name or the stock one.
 *
 * @category mix
 */
export function mix<I, O, H = unknown>(kit: Kit<O>, opts: MixOptions<H> = {}): Mix<I, O, H> {
  return (opts.engine ?? mixer).create<I, O, H>(kit, opts);
}
