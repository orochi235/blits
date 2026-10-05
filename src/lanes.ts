import type { Column } from './columns.js';
import { type Crowd, Flag, Hot, row } from './crowd.js';
import {
  call,
  fillAll,
  foldKeys,
  one,
  parting,
  readKeyed,
  reset,
  run,
  signalled,
  subjectAt,
} from './fill.js';
import { fold, foldDelta, foldInto, foldRun, gather } from './gather.js';
import { Begin, type Lane, type Laned, type Locus, Per, Row } from './lane.js';
import { meet, owable, reach } from './meet.js';
import type { Watcher } from './motion.js';
import { type absent, Numbers } from './numbers.js';
import { Owed } from './owed.js';
import { requalify, retouch } from './qualify.js';
import { reading } from './reading.js';
import { reportedRow, unplace } from './rows.js';
import type { Channel } from './types.js';
import type { Subject, Voice } from './voice.js';

/** What a lane fill asks of the mix it belongs to. */
export interface LaneHost<I, O> {
  readonly voices: readonly Voice<I, O>[];
  readonly channels: readonly Channel<unknown>[];
  readonly names: readonly string[];
  /** Whether a voice's patch and spec can run on a lane, its channels aside. */
  fits(voice: Voice<I, O>): boolean;
  /** The voice's record for a subject this probe has already linked it to, from `head` if there. */
  meet(
    voice: Voice<I, O>,
    subject: I,
    head: Subject<unknown> | null,
    slot: number,
  ): Subject<unknown>;
  /** The number `slot` was let go of, to be handed to another subject. */
  forgot(slot: number): void;
  /** The voices whose `subjects` name the subject, in voice order. */
  naming(subject: I): readonly Voice<I, O>[] | undefined;
  /** The subject's number, -1 where it has none yet. */
  slotOf(subject: I): number;
  /** The voice's own fade for a subject whose delay ran out at `since`. */
  envelope(voice: Voice<I, O>, since: number): number;
  /** What a subject's own ramp out of the voice leaves of its weight, 0..1. */
  parting(voice: Voice<I, O>, subject: I): number;
  /** Fills the voice's setting and the send target for a call to its patch. */
  ready(
    voice: Voice<I, O>,
    subject: I,
    held: Subject<unknown>,
    elapsed: number,
    pass: number,
    weight: number,
  ): void;
  /**
   * A voice with a signal weight: the signal's value for a subject the general path has met, before
   * the fade and ramp `weighed` applies, with the setting filled in for the call; makes the voice
   * stateful if the signal keeps state. `slot` is the subject's number.
   */
  signal(
    voice: Voice<I, O>,
    subject: I,
    held: Subject<unknown>,
    elapsed: number,
    pass: number,
    slot: number,
  ): number;
  /** Sets `reading.horizon` for the voice and a subject delayed `delay` voice ms. */
  horizon(voice: Voice<I, O>, delay: number): void;
  /** Whether the mix keeps history, so a record a patch call changed may need a copy kept. */
  readonly keeps: boolean;
  /** After a patch call, keeps history of a record that grew kept state. */
  after(voice: Voice<I, O>, held: Subject<unknown>): void;
  /** A patch call left kept state on a record: the voice is stateful from now on. */
  kept(voice: Voice<I, O>): void;
}

/**
 * The lanes of one mix: subject numbers, which channels and voices run on lanes, and the values a
 * frame's fill leaves for probes to copy.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: every member of `Methods` is installed below
export class Lanes<I, O> implements Watcher {
  readonly numbers: Numbers<I>;
  lanes: Lane<I, O>[] = [];
  /** The lanes over every subject that have started playing, by epoch. */
  dense: Lane<I, O>[] = [];
  readonly byId = new Map<number, Lane<I, O>>();
  /** The crowds of single-subject motion voices, one per channel, and which holds each voice. */
  crowds: Crowd<I, O>[] = [];
  readonly crowdOf = new Map<number, Crowd<I, O>>();
  /** Whether two crowds share a channel, so their rows must interleave in voice order. */
  overlap = false;
  /** The loci whose voices are on lanes, every member of each on one. */
  loci: Locus<I, O>[] = [];
  /** While a fill gathers a locus: that locus and the member gathering, where folds go instead. */
  into: Locus<I, O> | null = null;
  intoId = 0;
  readonly lawsByKey = new Map<string, Float64Array>();
  lastLaw: Float64Array | null = null;
  /** The lanes the last `meet` gave a position, and whether it placed a crowd row. */
  readonly met: number[] = [];
  metCrowd = false;
  /** By subject number, the laned voices its probes fold on the general path this fill. */
  readonly owed = new Owed();
  laned: Laned[] = [];
  /** By kit slot, the laned channel there. */
  bySlot: (Laned | undefined)[] = [];
  /** By kit slot, whether a fill leaves the channel's values for probes to copy. */
  readonly copies: boolean[] = [];
  /** Whether every voice in the mix is on a lane, so a filled subject has nothing left to fold. */
  whole = false;
  cap = 0;
  epochs = 0;
  /** The latest epoch of a lane over every subject, which every subject meets on its next probe. */
  wide = 0;
  /** Voices that joined, started or left since the last qualify, settled at the next probe. */
  touched: Voice<I, O>[] = [];
  /** The highest voice id the last qualify or settling of `touched` considered. */
  known = 0;
  /**
   * Per subject number, `SLOT` numbers side by side, so a probe reads one place in memory: which
   * fill last wrote it (0 for none); the latest lane epoch a probe of it has checked it against;
   * how many idle lanes reach it, since a probe reads lanes only where none do; and the probe count
   * at its last probe read from the lanes and at its last probe folded by the general path, with
   * the fill the former read, which say whether a lane or a record holds what `weightOf` reports.
   */
  per = new Float64Array(0);
  fills = 0;
  probes = 0;
  /**
   * Each subject by number as last probed, held from that probe until the next fill uses it, so a
   * fill rarely looks one up through its weak reference, which costs on every look. A host that
   * stops syncing keeps at most one frame's probed subjects alive until its next fill, and none
   * once no lane remains.
   */
  subjects: (I | typeof absent | undefined)[] = [];
  /** Whether a probe has held a subject since the last fill let them go. */
  holding = false;
  /** While a fill runs, so a probe a patch makes from inside it takes the general path. */
  filling = false;
  /**
   * Numbers a fill left to the general path: handed out while it ran, or with a voice whose call
   * the general path has to make.
   */
  readonly late: number[] = [];
  /**
   * What `writeLater` and `pullRun` have queued, for one set of columns, as runs: each run's first
   * lane slot, the row it goes to, and how many subjects follow both one apart.
   */
  queueSlots = new Int32Array(0);
  queueRows = new Int32Array(0);
  queueCounts = new Int32Array(0);
  queued = 0;
  queuedFor: readonly Column[] | null = null;
  keeps = false;
  now = Number.NaN;
  filledAt = Number.NaN;
  /** `reading.moved` at the last fill, so a retarget or push between two probes refills. */
  moved = 0;
  /** The `now` of the latest probe, and the probe count before its first, to tell a probe this frame. */
  frameAt = Number.NaN;
  frameProbes = 0;
  /** The probe counts the last frame with a probe began and ended at, which lanes go idle by. */
  lastFrom = 0;
  lastTo = 0;
  /** Set when a frame's first probe arrives, so its first fill decides which lanes go idle. */
  fresh = false;
  /** Subjects probed this frame and in the last frame with a probe, counted once each. */
  distinct = 0;
  lastDistinct = 0;
  /** Numbered subjects alive. */
  live = 0;
  filledVersion = Number.NaN;
  qualifiedVersion = Number.NaN;

  constructor(readonly host: LaneHost<I, O>) {
    this.numbers = new Numbers<I>(this);
  }

  /** A change that may move a voice on or off its lane: qualify again, then fill again. */
  invalidate(): void {
    this.qualifiedVersion = Number.NaN;
    this.filledVersion = Number.NaN;
  }

  /** A change to a laned voice's weight or clock between probes: fill again. */
  refill(): void {
    this.filledVersion = Number.NaN;
  }

  /**
   * A voice joined, started playing or left: the next probe takes it on or off its crowd where it
   * can, and qualifies again where it cannot.
   */
  touch(voice: Voice<I, O>): void {
    this.touched.push(voice);
    this.filledVersion = Number.NaN;
  }

  /** Numbers a subject the mix sees for the first time. */
  number(subject: I): number {
    const slot = this.numbers.take(subject);
    this.live++;
    this.grow(slot + 1);
    this.per[slot * Per.SLOT + Per.FILLED] = 0;
    this.per[slot * Per.SLOT + Per.SEEN] = -1;
    this.per[slot * Per.SLOT + Per.IDLE] = 0;
    this.per[slot * Per.SLOT + Per.LANE_PROBE] = 0;
    this.per[slot * Per.SLOT + Per.GENERAL_PROBE] = 0;
    this.per[slot * Per.SLOT + Per.LANE_FILL] = 0;
    if (this.filling) this.late.push(slot);
    return slot;
  }

  release(slot: number): void {
    this.numbers.release(slot);
  }

  /** A voice faded a subject out of itself alone: its lane lets the subject's position go. */
  part(id: number, slot: number): void {
    const lane = this.byId.get(id);
    if (lane !== undefined) {
      if (lane.positionOf(slot) < 0) return;
      if (lane.idle) reach(this, slot, -1);
      lane.remove(slot);
      return;
    }
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c !== undefined && p !== undefined && c.list[p] === slot) unplace(this, c, p);
  }

  /** A voice brought a subject back: its next probe meets every lane again, as it met them first. */
  rejoin(slot: number): void {
    if (slot < this.cap) this.per[slot * Per.SLOT + Per.SEEN] = -1;
  }

  /**
   * A laned voice's weight for a subject at the last frame a probe read it from the lane; undefined
   * where the subject's record holds it instead, because its last probe took the general path or
   * the voice is not on a lane.
   */
  weightOf(id: number, slot: number): number | undefined {
    if (slot < 0) return undefined;
    const lane = this.byId.get(id);
    if (lane !== undefined) return this.reported(lane, slot);
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    return c === undefined || p === undefined ? undefined : reportedRow(this, c, p, slot);
  }

  reported(lane: Lane<I, O>, slot: number): number | undefined {
    const o = slot * Per.SLOT;
    if (!((this.per[o + Per.LANE_PROBE] as number) > (this.per[o + Per.GENERAL_PROBE] as number)))
      return undefined;
    const p = lane.positionOf(slot);
    if (p < 0) return undefined;
    return lane.data[
      p * Row.STRIDE + (this.per[o + Per.LANE_FILL] === this.fills ? Row.WEIGHT : Row.PROBED)
    ];
  }

  /**
   * Fills the lanes once a frame, and says whether this probe of a subject reads its values from
   * them. One that a lane has not met yet, newly numbered or newly reached, takes the general path
   * this frame, which is where it is first seen; so does one probed from inside a fill.
   */
  prepare(
    slot: number,
    subject: I,
    now: number,
    version: number,
    head: Subject<unknown> | null,
  ): boolean {
    const ready = this.filled(now, version) ? Begin.READY : this.begin(now, version);
    if (ready === Begin.GENERAL) return this.general(slot);
    if (slot < 0) return false;
    if (!this.probedThisFrame(slot)) this.distinct++;
    const probe = ++this.probes;
    const per = this.per;
    const o = slot * Per.SLOT;
    let lane = per[o + Per.FILLED] === this.fills && per[o + Per.IDLE] === 0;
    if ((per[o + Per.SEEN] as number) < this.wide && meet(this, slot, subject, head)) {
      // The fill ran before the subject had these positions. Where every voice it just met folds
      // after every other laned voice, the general path folds just those onto the lanes' values;
      // otherwise it reads the general path all frame.
      if (lane && per[o + Per.IDLE] === 0 && owable(this, slot)) this.owed.owe(slot, this.met);
      else {
        per[o + Per.FILLED] = 0;
        lane = false;
      }
    }
    if (lane) {
      per[o + Per.LANE_PROBE] = probe;
      per[o + Per.LANE_FILL] = this.fills;
      this.subjects[slot] = subject;
      this.holding = true;
    } else per[o + Per.GENERAL_PROBE] = probe;
    return lane;
  }

  /** Whether this frame's lanes are filled and nothing since asks `begin` to look again. */
  filled(now: number, version: number): boolean {
    return (
      this.filledAt === now &&
      this.frameAt === now &&
      this.filledVersion === version &&
      this.qualifiedVersion === version &&
      this.moved === reading.moved &&
      this.touched.length === 0 &&
      !this.filling
    );
  }

  /**
   * What a probe does before its subject, once a frame's lanes are settled: qualifies and fills as
   * needed. Says whether the subject takes the general path or the lanes are filled.
   */
  begin(now: number, version: number): number {
    if (now !== this.frameAt) {
      this.lastFrom = this.frameProbes;
      this.lastTo = this.probes;
      this.lastDistinct = this.distinct;
      this.distinct = 0;
      this.frameAt = now;
      this.frameProbes = this.probes;
      this.fresh = true;
    }
    if (this.filling) return Begin.GENERAL;
    // The mix's version moves only when a voice over every subject comes, goes, starts or stops
    // waiting, each of which touches it, so a version past a qualify that stands is a set of touches.
    if (this.qualifiedVersion !== version) {
      if (!Number.isNaN(this.qualifiedVersion) && this.touched.length > 0 && retouch(this))
        this.qualifiedVersion = version;
      else requalify(this, version);
    } else if (this.touched.length > 0 && !retouch(this)) requalify(this, version);
    if (this.laned.length === 0) return Begin.GENERAL;
    if (this.filledAt !== now || this.filledVersion !== version || this.moved !== reading.moved) {
      fillAll(this, now, version);
      // A patch call in that fill made kept state, which took its voice off its lane: fill without it.
      if (this.qualifiedVersion !== version) {
        requalify(this, version);
        if (this.laned.length === 0) return Begin.GENERAL;
        fillAll(this, now, version);
      }
    }
    return Begin.READY;
  }

  general(slot: number): false {
    if (slot >= 0) this.per[slot * Per.SLOT + Per.GENERAL_PROBE] = ++this.probes;
    return false;
  }

  /** Whether a probe has read the subject since the frame began, on either path. */
  probedThisFrame(slot: number): boolean {
    const from = this.frameProbes;
    const o = slot * Per.SLOT;
    return (
      (this.per[o + Per.LANE_PROBE] as number) > from ||
      (this.per[o + Per.GENERAL_PROBE] as number) > from
    );
  }

  /** Whether the subject at `slot` reads some laned voice from the general path this fill. */
  owes(slot: number): boolean {
    return this.owed.owes(slot);
  }

  /** Whether the subject at `slot` reads laned voice `id` from the general path this fill. */
  owesVoice(slot: number, id: number): boolean {
    return this.owed.owesVoice(slot, id);
  }

  /** The weight the general path gave a voice the subject at `slot` owes, as `weightOf` reports. */
  paid(id: number, slot: number, w: number): void {
    const lane = this.byId.get(id);
    const p = lane === undefined ? -1 : lane.positionOf(slot);
    if (p >= 0) (lane as Lane<I, O>).data[p * Row.STRIDE + Row.WEIGHT] = w;
  }

  /**
   * Whether a subject's laned values are at their channels' rest, as `atRest` reads the pose `copy`
   * would write: each number within 1e-9 of its rest.
   */
  rests(slot: number): boolean {
    for (const ch of this.laned) {
      const values = ch.values;
      if (ch.scalar) {
        if (!(Math.abs((values[slot] as number) - ch.rest) < 1e-9)) return false;
        continue;
      }
      // `copy` lengthens a rest shorter than the channel's axes, and a longer array is never near it.
      if (ch.start.length < ch.axes) return false;
      const base = slot * ch.axes;
      for (let a = 0; a < ch.axes; a++)
        if (!(Math.abs((values[base + a] as number) - (ch.start[a] as number)) < 1e-9))
          return false;
    }
    return true;
  }

  /** Writes a subject's laned values into a pose, each array channel into a new array. */
  copy(slot: number, pose: Record<string, unknown>): void {
    const laned = this.laned;
    for (let c = 0; c < laned.length; c++) {
      const ch = laned[c] as Laned;
      const axes = ch.axes;
      if (ch.scalar) {
        pose[ch.name] = ch.values[slot] as number;
        continue;
      }
      // Made as the general path makes it, a copy of rest, so poses from either path share a shape.
      const arr = [...ch.start];
      const base = slot * axes;
      for (let a = 0; a < axes; a++) arr[a] = ch.values[base + a] as number;
      pose[ch.name] = arr;
    }
  }

  forget(slot: number): void {
    this.host.forgot(slot);
    this.live--;
    for (const lane of this.lanes) lane.remove(slot);
    for (const c of this.crowds)
      for (let p = 0; p < c.size; p++) if (c.list[p] === slot) unplace(this, c, p);
    if (slot < this.cap) this.per[slot * Per.SLOT + Per.FILLED] = 0;
    this.subjects[slot] = undefined;
  }

  grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2, 64);
    const per = new Float64Array(cap * Per.SLOT);
    per.set(this.per);
    this.per = per;
    this.owed.grow(cap);
    for (const ch of this.laned) {
      const values = new Float64Array(cap * ch.axes);
      values.set(ch.values);
      ch.values = values;
    }
    this.cap = cap;
  }

  /**
   * A laned voice's patch is about to change subject `s`'s stretch: a crowd copies it again at the
   * next fill, and a lane keeps the sample the old one gave.
   */
  stretchChanged(id: number, s: number): void {
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c !== undefined && p !== undefined) {
      c.restale(p, c.hot[p * c.stride + Hot.FLAGS] as number);
      return;
    }
    const lane = this.byId.get(id);
    const q = lane === undefined ? -1 : lane.positionOfMotion(s);
    if (q >= 0) (lane as Lane<I, O>).fix(q);
  }

  /** Something on a voice changed: a crowd copies it again at the next fill. */
  voiceChanged(id: number): void {
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c === undefined || p === undefined) return;
    const f = p * c.stride + Hot.FLAGS;
    c.hot[f] = (c.hot[f] as number) | Flag.VOICE;
  }
}

// A fill's per-subject path is methods, installed here from the modules that own them: as
// functions called directly they made fills 5-8% slower (bench/ab.sh on teitou, 2026-10-05).
const methods = {
  row,
  signalled,
  parting,
  subjectAt,
  reset,
  run,
  one,
  foldKeys,
  readKeyed,
  call,
  gather,
  fold,
  foldDelta,
  foldRun,
  foldInto,
};
type Methods = typeof methods;
// biome-ignore lint/correctness/noUnusedVariables: merging needs the class's type parameters
export interface Lanes<I, O> extends Methods {}
for (const [name, value] of Object.entries(methods))
  Object.defineProperty(Lanes.prototype, name, { value, writable: true, configurable: true });
