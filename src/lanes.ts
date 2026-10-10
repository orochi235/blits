import type { Column } from './columns.js';
import { copy } from './copyout.js';
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
  runEveryone,
  signalled,
  subjectAt,
} from './fill.js';
import { fold, foldDelta, foldInto, foldRun, gate, gather, unplain } from './gather.js';
import { Arg, Begin, type Lane, type Laned, type Locus, Per, Row } from './lane.js';
import { meet, reach } from './meet.js';
import type { Watcher } from './motions.js';
import { absent, Numbers } from './numbers.js';
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
  /** The mix itself, for its clock: a getter V8 does not inline would box `now` on return. */
  readonly clock: { readonly now: number };
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
  /** Whether a rest-less channel's contribution passes the band, as the general path decides it. */
  passes(was: boolean | undefined, w: number): boolean;
  /** Sets `reading.horizon` for the voice and a subject delayed `delay` voice ms. */
  horizon(voice: Voice<I, O>, delay: number): void;
  /** Whether the mix keeps history, so a record a patch call changed may need a copy kept. */
  readonly keeps: boolean;
  /** After a patch call, keeps history of a record that grew kept state. */
  after(voice: Voice<I, O>, subject: I, held: Subject<unknown>): void;
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
  /** The crowds of single-subject voices, one per list of channels, and which holds each voice. */
  crowds: Crowd<I, O>[] = [];
  readonly crowdOf = new Map<number, Crowd<I, O>>();
  /** Whether two crowds share a channel, so their rows must interleave in voice order. */
  overlap = false;
  /** The loci whose voices are on lanes, every member of each on one. */
  loci: Locus<I, O>[] = [];
  /** The lane and record `one` is folding, whose band state a rest-less channel reads. */
  folding: Lane<I, O> | null = null;
  rec: Subject<unknown> | null = null;
  /** The numbers a fill's methods hand each other: see `Arg`. */
  readonly arg = new Float64Array(Arg.SIZE);
  /** While a fill gathers a locus: that locus and the member gathering, where folds go instead. */
  into: Locus<I, O> | null = null;
  intoId = 0;
  readonly lawsByKey = new Map<string, Float64Array>();
  lastLaw: Float64Array | null = null;
  /**
   * The lanes the last `meet` gave a position, the first `metN` of `met`, and whether it placed a
   * crowd row. Counted, not cut to length: an array emptied by its length takes new room at its
   * next push, about 150 B a subject met (the `swap` row, bench/allocs.mjs, 2026-10-09).
   */
  readonly met: number[] = [];
  metN = 0;
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
   * Per subject number, `SLOT` numbers side by side, so a probe reads one place in memory: the
   * fill that last left it to the general path, being late, owing, newly numbered or forgotten;
   * the latest lane epoch a probe of it has checked it against; how many idle lanes reach it,
   * since a probe reads lanes only where none do; and the probe count at its last probe read from
   * the lanes and at its last probe folded by the general path, with the fill the former read,
   * which say whether a lane or a record holds what `weightOf` reports.
   */
  per = new Float64Array(0);
  fills = 0;
  /** The latest fill if it ran a lane, else 0: a subject whose `FILLED` is below it reads it. */
  busyFill = 0;
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
  /** `reading.moved` and `reading.inputs` at the last fill: see `current`. */
  moved = 0;
  inputs = 0;
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
  /**
   * The probe count a subject's last probe must pass for this fill to fill it: the start of the
   * last frame with a probe, or -1 while every subject alive was probed then, when it fills all.
   */
  lately = -1;
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
    this.per[slot * Per.SLOT + Per.FILLED] = this.fills;
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
  prepare(slot: number, subject: I, version: number, head: Subject<unknown> | null): boolean {
    // Read, not passed: a double passed to a call V8 does not inline is boxed, once a probe.
    const now = this.host.clock.now;
    if (!this.filled(now, version) && this.begin(now, version) === Begin.GENERAL)
      return this.general(slot);
    if (slot < 0) return false;
    if (!this.probedThisFrame(slot)) this.distinct++;
    const probe = ++this.probes;
    const per = this.per;
    const o = slot * Per.SLOT;
    let lane = (per[o + Per.FILLED] as number) < this.busyFill && per[o + Per.IDLE] === 0;
    if ((per[o + Per.SEEN] as number) < this.wide) lane = meet(this, slot, subject, head, lane);
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
      this.frameAt === now &&
      this.qualifiedVersion === version &&
      this.touched.length === 0 &&
      !this.filling &&
      this.current(now, version)
    );
  }

  /**
   * Whether the last fill still stands: everything a fill reads that can change between two probes,
   * each stamped by `fillAll`. The clock; the mix's version, which voices coming, going, starting
   * and stopping move; a motion's retargets and pushes; and a `level` set. Whatever else can change
   * between probes keeps its voice off lanes in `fits`.
   */
  current(now: number, version: number): boolean {
    return (
      this.filledAt === now &&
      this.filledVersion === version &&
      this.moved === reading.moved &&
      this.inputs === reading.inputs
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
    // Past a qualify that stands, the mix's version moves when a voice over every subject comes,
    // goes, starts or stops waiting, each of which touches it, or stops sharing one record, which
    // moves no voice on or off a lane: so with voices touched it is a set of touches.
    if (this.qualifiedVersion !== version) {
      if (!Number.isNaN(this.qualifiedVersion) && this.touched.length > 0 && retouch(this))
        this.qualifiedVersion = version;
      else requalify(this, version);
    } else if (this.touched.length > 0 && !retouch(this)) requalify(this, version);
    if (this.laned.length === 0) return Begin.GENERAL;
    if (!this.current(now, version)) {
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

  /**
   * Whether this fill leaves the subject at `slot` to the general path, for not having been probed
   * this frame or the last: a probe of it before the next fill then takes the general path.
   */
  unread(slot: number): boolean {
    const per = this.per;
    const o = slot * Per.SLOT;
    const lately = this.lately;
    if (
      (per[o + Per.LANE_PROBE] as number) > lately ||
      (per[o + Per.GENERAL_PROBE] as number) > lately
    )
      return false;
    per[o + Per.FILLED] = this.fills;
    return true;
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
      if (ch.op === 'last') {
        if (!Number.isNaN(values[slot * ch.axes] as number)) return false;
        continue;
      }
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

  forget(slot: number): void {
    this.host.forgot(slot);
    this.live--;
    for (const lane of this.lanes) lane.remove(slot);
    for (const c of this.crowds)
      for (let p = 0; p < c.size; p++) if (c.list[p] === slot) unplace(this, c, p);
    if (slot < this.cap) this.per[slot * Per.SLOT + Per.FILLED] = this.fills;
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

  /**
   * A voice that kept one record for every subject keeps one each from now on: each of its lane's
   * positions takes the record `of` gives its subject.
   */
  rerecord(id: number, of: (subject: I, slot: number) => Subject<unknown>): void {
    const lane = this.byId.get(id);
    if (lane === undefined) return;
    for (let p = 0; p < lane.list.length; p++) {
      const slot = lane.list[p] as number;
      const subject = this.subjectAt(slot);
      if (subject !== absent) lane.records[p] = of(subject as I, slot);
    }
  }

  /** A voice's clock moved the `shown` of records it had already placed: copies them again. */
  reshown(id: number): void {
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c !== undefined && p !== undefined) {
      const held = c.records[p];
      if (held !== undefined) c.data[p * Row.STRIDE + Row.SINCE] = held.shown;
    }
    const lane = this.byId.get(id);
    if (lane === undefined) return;
    for (let q = 0; q < lane.list.length; q++) {
      const held = lane.records[q];
      if (held !== undefined) lane.data[q * Row.STRIDE + Row.SINCE] = held.shown;
    }
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
  copy,
  row,
  signalled,
  parting,
  subjectAt,
  reset,
  run,
  runEveryone,
  one,
  foldKeys,
  readKeyed,
  call,
  gather,
  fold,
  foldDelta,
  foldRun,
  foldInto,
  gate,
  unplain,
};
type Methods = typeof methods;
// biome-ignore lint/correctness/noUnusedVariables: merging needs the class's type parameters
export interface Lanes<I, O> extends Methods {}
for (const [name, value] of Object.entries(methods))
  Object.defineProperty(Lanes.prototype, name, { value, writable: true, configurable: true });
