import { flush, pullRun, writeLater } from './columns.js';
import { type Copier, copy } from './copyout.js';
import { type Crowd, row } from './crowd.js';
import { share } from './everyone.js';
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
import { Arg, Begin, type Lane, type Laned, Per, type Role } from './lane.js';
import type { LaneHost } from './lanehost.js';
import {
  alone,
  forget,
  grow,
  number,
  rejoin,
  release,
  renew,
  seatFor,
  sought,
} from './lanesubjects.js';
import {
  owes,
  owesVoice,
  paid,
  part,
  reported,
  rerecord,
  reshown,
  stretchChanged,
  voiceChanged,
  weightOf,
} from './lanevoices.js';
import { meet } from './meet.js';
import { type absent, Numbers } from './numbers.js';
import { Owed } from './owed.js';
import { Placed } from './placed.js';
import type { Column } from './pull.js';
import { requalify, retouch } from './qualify.js';
import { reading } from './reading.js';
import { renumber } from './renumber.js';
import type { Seat } from './seat.js';
import type { Watcher } from './stretch.js';
import type { Subject } from './subject.js';
import type { Voice } from './voice.js';

export type { LaneHost } from './lanehost.js';

/**
 * The lanes of one mix: subject numbers, which channels and voices run on lanes, and the values a
 * frame's fill leaves for probes to copy.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: every member of `Methods` is installed below
export class Lanes<I, O> implements Watcher {
  /** What the general path calls on a sharing voice, given to a mix by its engine so a lean bundle leaves it out. */
  static readonly share = share;
  /** What `pull` calls on lanes alone. */
  readonly pulls = { pullRun, writeLater, flush, renumber };
  readonly numbers: Numbers<I>;
  lanes: Lane<I, O>[] = [];
  /** The lanes over every subject that have started playing, by epoch. */
  dense: Lane<I, O>[] = [];
  readonly byId = new Map<number, Lane<I, O>>();
  /** The crowds of single-subject voices, one per list of channels, and which holds each voice. */
  crowds: Crowd<I, O>[] = [];
  readonly seats = new Map<number, Seat<I, O>>();
  /** Which crowd voices' rows are placed on each subject. */
  readonly placed = new Placed<Voice<I, O>>();
  /**
   * By subject number, the mix's `relinks` when the subject's chain was last made stale by itself,
   * so `pull` tells a head it remembers is stale without reading the head.
   */
  unlinked = new Float64Array(0);
  /** Whether two crowds share a channel, so their rows must interleave in voice order. */
  overlap = false;
  /** The roles whose voices are on lanes, every member of each on one. */
  roles: Role<I, O>[] = [];
  /** The lane and record `one` is folding, whose band state a rest-less channel reads. */
  folding: Lane<I, O> | null = null;
  /** Whether a probe meeting lanes has `one` make their first call for its subject: see `meet`. */
  meeting = false;
  /** The lanes the last subject met and `foldNow` folded at its probe, and the fill it did so in. */
  folds: number[] = [];
  foldsFill = -1;
  rec: Subject<unknown> | null = null;
  /** The numbers a fill's methods hand each other: see `Arg`. */
  readonly arg = new Float64Array(Arg.SIZE);
  /** While a fill gathers a role: that role and the member gathering, where folds go instead. */
  into: Role<I, O> | null = null;
  intoId = 0;
  /** The place in its role of the member `intoId` names. */
  intoMember = 0;
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
  /** Writes `laned`'s values for a subject into a pose; made at the first copy after they change. */
  copier: Copier | null = null;
  /** By kit slot, the laned channel there. */
  bySlot: (Laned | undefined)[] = [];
  /** By kit slot, whether a fill leaves the channel's values for probes to copy. */
  readonly copies: boolean[] = [];
  /** Whether every voice in the mix is on a lane, so a filled subject has nothing left to fold. */
  whole = false;
  /**
   * While not `whole`: whether a voice off lanes may reach any subject, one naming none; and by
   * subject number, 1 where one naming its subjects may, else 0. All 0 while `whole`.
   */
  offAll = true;
  off = new Uint8Array(0);
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
  /**
   * Whether probes hold their subjects for the next fill: while the last fill looked one up. A
   * fill of bare tweens never does, and holding cost a store a subject and a clear a frame.
   */
  holds = true;
  /** How many times a fill or a probe has looked a subject up by number, for `holds`. */
  lookups = 0;
  /** While a fill runs, so a probe a patch makes from inside it takes the general path. */
  filling = false;
  /**
   * Numbers a fill left to the general path: handed out while it ran, or with a voice whose call
   * the general path has to make.
   */
  readonly late: number[] = [];
  /**
   * What `writeLater` and `pullRun` have queued, for one set of columns, as runs of rows: each
   * run's first row and how many follow, and its first lane slot where its slots follow one apart
   * too, else -1, when each row's slot is read from `queueFrom` by row.
   */
  queueSlots = new Int32Array(0);
  queueRows = new Int32Array(0);
  queueCounts = new Int32Array(0);
  queued = 0;
  queuedFor: readonly Column[] | null = null;
  queueFrom: Int32Array | null = null;
  keeps = false;
  /**
   * By subject number, the `pull` certain to read the subject, while `pulling` is that pull's
   * number, else 0: a fill may commit such a subject's motion changes, as that read would.
   */
  readBy = new Int32Array(0);
  pulling = 0;
  pullCount = 0;
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

  /**
   * With `from`, the lanes a seek replaces: their subject numbers carry over, each met as newly
   * numbered when its chain is next linked (`renew`), so a seek makes no new weak reference per
   * subject.
   */
  constructor(
    readonly host: LaneHost<I, O>,
    from?: Lanes<I, O>,
  ) {
    if (from === undefined) {
      this.numbers = new Numbers<I>(this);
      return;
    }
    this.numbers = from.numbers;
    this.numbers.adopt(this);
    this.live = from.live;
    const size = this.numbers.size;
    this.grow(size);
    const per = this.per;
    for (let slot = 0; slot < size; slot++) {
      per[slot * Per.SLOT + Per.FILLED] = Number.NaN;
      per[slot * Per.SLOT + Per.SEEN] = -1;
    }
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
      if (this.holds) {
        this.subjects[slot] = subject;
        this.holding = true;
      }
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
   * between probes keeps its voice off lanes in `unfit`.
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
}

// A fill's per-subject path, and what numbers subjects and hears of voices, is methods, installed
// here from the modules that own them: as functions called directly they made fills 5-8% slower
// (bench/ab.sh on teitou, 2026-10-05). A probe's own path stays in the class body.
const methods = {
  number,
  alone,
  release,
  sought,
  renew,
  rejoin,
  forget,
  seatFor,
  grow,
  part,
  weightOf,
  reported,
  owes,
  owesVoice,
  paid,
  stretchChanged,
  rerecord,
  reshown,
  voiceChanged,
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
