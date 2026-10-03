import { foldNumber, type Numeric, numericOf } from './channels.js';
import { clampWeight, passAt, phaseAt } from './clock.js';
import type { Subject, Voice } from './mixer.js';
import { type Motions, motionOf } from './motion.js';
import { absent, Numbers } from './numbers.js';
import { readKeys, type Scratch } from './patch.js';
import { reading } from './reading.js';
import type { Channel } from './types.js';

/** What qualifying needs of one voice: whether its patch and spec can run on a lane, and its channels. */
export interface Candidate {
  readonly id: number;
  readonly fits: boolean;
  readonly slots: readonly number[];
}

/**
 * Which channels run as lanes and which voices run on them: the fixed point where every voice
 * writing a laned channel fits and writes only laned channels. Only channels some laned voice
 * writes are laned.
 */
export function qualify(
  numeric: readonly boolean[],
  voices: readonly Candidate[],
): { channels: boolean[]; voices: Set<number> } {
  const open = numeric.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of voices) {
      if (v.fits && v.slots.every((s) => open[s])) continue;
      for (const s of v.slots)
        if (open[s]) {
          open[s] = false;
          changed = true;
        }
    }
  }
  const laned = new Set<number>();
  const channels = numeric.map(() => false);
  for (const v of voices) {
    if (!v.fits || !v.slots.every((s) => open[s])) continue;
    laned.add(v.id);
    for (const s of v.slots) channels[s] = true;
  }
  return { channels, voices: laned };
}

/** What a lane fill asks of the mix it belongs to. */
export interface LaneHost<I, O> {
  readonly voices: readonly Voice<I, O>[];
  readonly channels: readonly Channel<unknown>[];
  readonly names: readonly string[];
  /** Whether a voice's patch and spec can run on a lane, its channels aside. */
  fits(voice: Voice<I, O>): boolean;
  /** The voice's record for a subject this probe has already linked it to. */
  meet(voice: Voice<I, O>, subject: I): Subject<unknown>;
  /** The voices whose `subjects` name the subject, in voice order. */
  naming(subject: I): readonly Voice<I, O>[] | undefined;
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
  /** Sets `reading.horizon` for the voice and a subject delayed `delay` voice ms. */
  horizon(voice: Voice<I, O>, delay: number): void;
  /** Whether the mix keeps history, so a record a patch call changed may need a copy kept. */
  readonly keeps: boolean;
  /** After a patch call, keeps history of a record that grew kept state. */
  after(voice: Voice<I, O>, held: Subject<unknown>): void;
  /** A patch call left kept state on a record: the voice is stateful from now on. */
  kept(voice: Voice<I, O>): void;
}

/** One laned channel: its arithmetic, and every numbered subject's folded value, `axes` per subject. */
interface Laned {
  name: string;
  op: Numeric['op'];
  rest: number;
  axes: number;
  values: Float64Array;
  /** An array channel's rest, which a copy starts from as the general path's does. */
  start: readonly number[];
}

/** One channel `pull` writes: where in the kit, how many numbers a subject, and its rest. */
export interface Column {
  key: string;
  slot: number;
  axes: number;
  out: Float64Array;
  /** The rest, clamped, or NaN for a channel with none. */
  rest: Float64Array;
  bounds: readonly [number, number] | undefined;
}

export function clampRun(
  out: Float64Array,
  at: number,
  n: number,
  [lo, hi]: readonly [number, number],
): void {
  for (let i = at; i < at + n; i++) {
    const x = out[i] as number;
    out[i] = x < lo ? lo : x > hi ? hi : x;
  }
}

const STRIDE = 7;
const DELAY = 0;
const SINCE = 1;
/** The weight the last fill gave the subject. */
const WEIGHT = 2;
/** The weight a fill gave it the last time a probe read it from the lane. */
const PROBED = 3;
const MSLOT = 4;
/** For a motion voice, the last fill that sampled the subject, and the voice's seeks then. */
const SAMPLED = 5;
const SEEKS = 6;

const SLOT = 6;
const FILLED = 0;
const SEEN = 1;
const IDLE = 2;
const LANE_PROBE = 3;
const GENERAL_PROBE = 4;
const LANE_FILL = 5;

/**
 * Below what share of its subjects probed last frame a lane stops filling, and above what share it
 * fills again; between the two it keeps doing what it did, so a host near the line does not flip
 * every frame. Measured at 10k and 1k subjects (2026-10-02, one local machine): filling breaks even
 * with probing through the general path at about 19% probed for keys at both sizes, 71-77% for a
 * spring, and 63% (1k) to about 100% (10k) for a stateless fn.
 */
const SPARSE = { keys: { stop: 0.15, start: 0.25 }, other: { stop: 0.6, start: 0.8 } };

/** The least prime at least `n`, and 1 below 2. */
function primeFrom(n: number): number {
  if (n < 2) return 1;
  for (let c = n; ; c++) {
    let prime = true;
    for (let d = 2; d * d <= c; d++)
      if (c % d === 0) {
        prime = false;
        break;
      }
    if (prime) return c;
  }
}

/**
 * What one laned voice keeps per subject it reaches, by position in `list`. A subject gets a
 * position when a probe of it first finds the voice playing, which is when the general path first
 * sees it too.
 */
class Lane<I, O> {
  /** The subject number at each position. */
  readonly list: number[] = [];
  private readonly at = new Map<number, number>();
  /** Whether too few of its subjects were probed lately to fill it: theirs take the general path. */
  idle = false;
  /** The lines it goes idle and busy at, by its patch form. */
  readonly line: { stop: number; start: number };
  /**
   * A `fn` or `keys` voice naming one subject, which shares nothing across subjects for a fill to
   * save, so it stays idle: its subject takes the general path, and the channel stays a lane for
   * the voices that do share.
   */
  readonly solo: boolean;
  /**
   * When the voice started playing on its lane, in the order lanes did; 0 while it waits. A subject
   * checked against every lane up to some epoch has met this one if this one's is no later.
   */
  epoch = 0;
  /**
   * Per position, `STRIDE` numbers side by side, so one subject's are one read from memory: its
   * delay, its `since`, its weight at the last fill, its weight at the last fill a probe read, a
   * motion patch's own number for it (-1 until asked), and the fill and seeks of its last sample.
   */
  data = new Float64Array(0);
  records: (Subject<unknown> | undefined)[] = [];
  /**
   * For a motion voice, per position, the delta its last sample made; null where that sample was
   * kept only in `samples`, until a probe asks for it.
   */
  deltas: (Record<string, unknown> | null)[] = [];
  /** For a motion voice, per position, its last sample's value on each of `axes` axes. */
  samples = new Float64Array(0);
  axes = 0;
  /** What a keys read writes into, reused across subjects. */
  readonly delta: Record<string, unknown> = {};
  /** The arrays keyed reads interpolate into: the lane's own, so a probe mid-fill cannot move them. */
  readonly scratch: Scratch = [];
  /** The laned channel of each channel the voice writes, in `writes` order. */
  chans: Laned[] = [];
  /** The value read for each of `chans`, for the subject being folded. */
  values: unknown[] = [];
  /**
   * Within one fill, the last elapsed placed and the last `since` weighed, with what they gave, so
   * subjects sharing a delay or a start share the arithmetic: the same inputs give the same bits.
   */
  placed = false;
  placedAt = 0;
  phase = 0;
  pass = 0;
  read = false;
  readAt = 0;
  weighed = false;
  weighedSince = 0;
  fade = 1;
  /** Whether the voice has no fade in or out this fill, so its envelope is 1 for every subject. */
  flat = false;
  /** A motion patch's state, which the lane samples in place of calling the patch. */
  readonly motion: Motions<I> | undefined;

  constructor(readonly voice: Voice<I, O>) {
    this.motion = motionOf<I>(voice.patch);
    this.line = voice.built !== null ? SPARSE.keys : SPARSE.other;
    this.solo = voice.named !== null && voice.named.size === 1 && this.motion === undefined;
    this.idle = this.solo;
  }

  positionOf(slot: number): number {
    return this.at.get(slot) ?? -1;
  }

  /** Gives a subject the voice reaches a position, from what its record fixed on first sight. */
  add(slot: number, held: Subject<unknown>): void {
    const p = this.list.length;
    this.list.push(slot);
    this.at.set(slot, p);
    if ((p + 1) * STRIDE > this.data.length) {
      const data = new Float64Array(Math.max(p + 1, (this.data.length / STRIDE) * 2, 4) * STRIDE);
      data.set(this.data);
      this.data = data;
    }
    const o = p * STRIDE;
    this.data[o + DELAY] = held.delay;
    this.data[o + SINCE] = held.since;
    this.data[o + WEIGHT] = 0;
    this.data[o + PROBED] = 0;
    this.data[o + MSLOT] = -1;
    this.data[o + SAMPLED] = -1;
    this.records[p] = held;
    this.deltas[p] = null;
  }

  /** A subject lost its number: the last position moves into its place. */
  remove(slot: number): void {
    const p = this.at.get(slot);
    if (p === undefined) return;
    const last = this.list.length - 1;
    if (p !== last) {
      const moved = this.list[last] as number;
      this.list[p] = moved;
      this.at.set(moved, p);
      this.data.copyWithin(p * STRIDE, last * STRIDE, (last + 1) * STRIDE);
      this.records[p] = this.records[last];
      this.deltas[p] = this.deltas[last] ?? null;
      const n = this.axes;
      if (n > 0) this.samples.copyWithin(p * n, last * n, (last + 1) * n);
    }
    this.list.pop();
    this.at.delete(slot);
    this.records[last] = undefined;
    this.deltas[last] = null;
  }
}

/**
 * The lanes of one mix: subject numbers, which channels and voices run on lanes, and the values a
 * frame's fill leaves for probes to copy.
 */
export class Lanes<I, O> {
  private readonly numbers: Numbers<I>;
  private lanes: Lane<I, O>[] = [];
  /** The lanes a fill visits: every lane but the solo ones. */
  private runs: Lane<I, O>[] = [];
  /** The lanes over every subject that have started playing, by epoch. */
  private dense: Lane<I, O>[] = [];
  private readonly byId = new Map<number, Lane<I, O>>();
  private laned: Laned[] = [];
  /** By kit slot, the laned channel there. */
  private bySlot: (Laned | undefined)[] = [];
  /** By kit slot, whether a fill leaves the channel's values for probes to copy. */
  readonly copies: boolean[] = [];
  /** Whether every voice in the mix is on a lane, so a filled subject has nothing left to fold. */
  whole = false;
  private cap = 0;
  private epochs = 0;
  /**
   * Per subject number, `SLOT` numbers side by side, so a probe reads one place in memory: which
   * fill last wrote it (0 for none); the latest lane epoch a probe of it has checked it against;
   * how many idle lanes reach it, since a probe reads lanes only where none do; and the probe count
   * at its last probe read from the lanes and at its last probe folded by the general path, with
   * the fill the former read, which say whether a lane or a record holds what `weightOf` reports.
   */
  private per = new Float64Array(0);
  private fills = 0;
  private probes = 0;
  /**
   * Each subject by number as last probed, held from that probe until the next fill uses it, so a
   * fill rarely looks one up through its weak reference, which costs on every look. A host that
   * stops syncing keeps at most one frame's probed subjects alive until its next fill, and none
   * once no lane remains.
   */
  private subjects: (I | typeof absent | undefined)[] = [];
  /** Whether a probe has held a subject since the last fill let them go. */
  private holding = false;
  /** While a fill runs, so a probe a patch makes from inside it takes the general path. */
  private filling = false;
  /**
   * Numbers a fill left to the general path: handed out while it ran, or with a voice whose call
   * the general path has to make.
   */
  private readonly late: number[] = [];
  private keeps = false;
  private now = Number.NaN;
  private filledAt = Number.NaN;
  /** `reading.moved` at the last fill, so a retarget or push between two probes refills. */
  private moved = 0;
  /** The `now` of the latest probe, and the probe count before its first, to tell a probe this frame. */
  private frameAt = Number.NaN;
  private frameProbes = 0;
  /** The probe counts the last frame with a probe began and ended at, which lanes go idle by. */
  private lastFrom = 0;
  private lastTo = 0;
  /** Set when a frame's first probe arrives, so its first fill decides which lanes go idle. */
  private fresh = false;
  /** Subjects probed this frame and in the last frame with a probe, counted once each. */
  private distinct = 0;
  private lastDistinct = 0;
  /** Numbered subjects alive. */
  private live = 0;
  private filledVersion = Number.NaN;
  private qualifiedVersion = Number.NaN;

  constructor(private readonly host: LaneHost<I, O>) {
    this.numbers = new Numbers<I>((slot) => this.forget(slot));
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

  /** Numbers a subject the mix sees for the first time. */
  number(subject: I): number {
    const slot = this.numbers.take(subject);
    this.live++;
    this.grow(slot + 1);
    this.per[slot * SLOT + FILLED] = 0;
    this.per[slot * SLOT + SEEN] = 0;
    this.per[slot * SLOT + IDLE] = 0;
    this.per[slot * SLOT + LANE_PROBE] = 0;
    this.per[slot * SLOT + GENERAL_PROBE] = 0;
    this.per[slot * SLOT + LANE_FILL] = 0;
    if (this.filling) this.late.push(slot);
    return slot;
  }

  release(slot: number): void {
    this.numbers.release(slot);
  }

  /** A voice faded a subject out of itself alone: its lane lets the subject's position go. */
  part(id: number, slot: number): void {
    const lane = this.byId.get(id);
    if (lane === undefined || lane.positionOf(slot) < 0) return;
    if (lane.idle) this.reach(slot, -1);
    lane.remove(slot);
  }

  /** A voice brought a subject back: its next probe meets every lane again, as it met them first. */
  rejoin(slot: number): void {
    if (slot < this.cap) this.per[slot * SLOT + SEEN] = 0;
  }

  /**
   * A laned voice's weight for a subject at the last frame a probe read it from the lane; undefined
   * where the subject's record holds it instead, because its last probe took the general path or
   * the voice is not on a lane.
   */
  weightOf(id: number, slot: number): number | undefined {
    const lane = this.byId.get(id);
    if (lane === undefined || slot < 0) return undefined;
    return this.reported(lane, slot);
  }

  private reported(lane: Lane<I, O>, slot: number): number | undefined {
    const o = slot * SLOT;
    if (!((this.per[o + LANE_PROBE] as number) > (this.per[o + GENERAL_PROBE] as number)))
      return undefined;
    const p = lane.positionOf(slot);
    if (p < 0) return undefined;
    return lane.data[p * STRIDE + (this.per[o + LANE_FILL] === this.fills ? WEIGHT : PROBED)];
  }

  /**
   * Fills the lanes once a frame, and says whether this probe of a subject reads its values from
   * them. One that a lane has not met yet, newly numbered or newly reached, takes the general path
   * this frame, which is where it is first seen; so does one probed from inside a fill.
   */
  prepare(slot: number, subject: I, now: number, version: number): boolean {
    if (now !== this.frameAt) {
      this.lastFrom = this.frameProbes;
      this.lastTo = this.probes;
      this.lastDistinct = this.distinct;
      this.distinct = 0;
      this.frameAt = now;
      this.frameProbes = this.probes;
      this.fresh = true;
    }
    if (this.filling) return this.general(slot);
    if (this.qualifiedVersion !== version) this.requalify(version);
    if (this.laned.length === 0) return this.general(slot);
    // Only solo lanes: nothing to fill, and every subject takes the general path.
    if (this.runs.length === 0) {
      if (slot < 0) return false;
      if ((this.per[slot * SLOT + SEEN] as number) < this.epochs) this.meet(slot, subject);
      return this.general(slot);
    }
    if (slot >= 0 && !this.probedThisFrame(slot)) this.distinct++;
    if (this.filledAt !== now || this.filledVersion !== version || this.moved !== reading.moved) {
      this.fillAll(now, version);
      // A patch call in that fill made kept state, which took its voice off its lane: fill without it.
      if (this.qualifiedVersion !== version) {
        this.requalify(version);
        if (this.laned.length === 0) return this.general(slot);
        this.fillAll(now, version);
      }
    }
    if (slot < 0) return false;
    const probe = ++this.probes;
    const per = this.per;
    const o = slot * SLOT;
    let lane = per[o + FILLED] === this.fills && per[o + IDLE] === 0;
    if ((per[o + SEEN] as number) < this.epochs && this.meet(slot, subject)) {
      // The fill ran before the subject had these positions, so it reads the general path all frame.
      per[o + FILLED] = 0;
      lane = false;
    }
    if (lane) {
      per[o + LANE_PROBE] = probe;
      per[o + LANE_FILL] = this.fills;
      this.subjects[slot] = subject;
      this.holding = true;
    } else per[o + GENERAL_PROBE] = probe;
    return lane;
  }

  private general(slot: number): false {
    if (slot >= 0) this.per[slot * SLOT + GENERAL_PROBE] = ++this.probes;
    return false;
  }

  /** Whether a probe has read the subject since the frame began, on either path. */
  private probedThisFrame(slot: number): boolean {
    const from = this.frameProbes;
    const o = slot * SLOT;
    return (
      (this.per[o + LANE_PROBE] as number) > from || (this.per[o + GENERAL_PROBE] as number) > from
    );
  }

  /**
   * Writes a subject's values into each column at subject `n`'s places, for a probe that reads from
   * the lanes while every voice is on one: a channel no lane holds is at rest.
   */
  write(slot: number, columns: readonly Column[], n: number): void {
    const bySlot = this.bySlot;
    for (let k = 0; k < columns.length; k++) {
      const c = columns[k] as Column;
      const axes = c.axes;
      const out = c.out;
      const at = n * axes;
      const ch = bySlot[c.slot];
      if (ch === undefined) {
        for (let a = 0; a < axes; a++) out[at + a] = c.rest[a] as number;
        continue;
      }
      const values = ch.values;
      const base = slot * axes;
      for (let a = 0; a < axes; a++) out[at + a] = values[base + a] as number;
      if (c.bounds !== undefined) clampRun(out, at, axes, c.bounds);
    }
  }

  /** Writes a subject's laned values into a pose, each array channel into a new array. */
  copy(slot: number, pose: Record<string, unknown>): void {
    const laned = this.laned;
    for (let c = 0; c < laned.length; c++) {
      const ch = laned[c] as Laned;
      const axes = ch.axes;
      if (axes === 1) {
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

  /**
   * Gives a probed subject a position on every lane that started playing since the subject was last
   * checked and that reaches it. True when any did, so the probe takes the general path.
   */
  private meet(slot: number, subject: I): boolean {
    const from = this.per[slot * SLOT + SEEN] as number;
    this.per[slot * SLOT + SEEN] = this.epochs;
    let met = false;
    const dense = this.dense;
    for (let i = dense.length - 1; i >= 0; i--) {
      const lane = dense[i] as Lane<I, O>;
      if (lane.epoch <= from) break;
      if (lane.positionOf(slot) >= 0) continue;
      const held = this.host.meet(lane.voice, subject);
      if (!held.reaches) continue;
      lane.add(slot, held);
      if (lane.idle) this.reach(slot, 1);
      met = true;
    }
    const naming = this.host.naming(subject);
    if (naming !== undefined)
      for (const voice of naming) {
        const lane = this.byId.get(voice.id);
        if (lane === undefined || lane.epoch <= from || lane.positionOf(slot) >= 0) continue;
        const held = this.host.meet(voice, subject);
        if (!held.reaches) continue;
        lane.add(slot, held);
        if (lane.idle) this.reach(slot, 1);
        met = true;
      }
    return met;
  }

  /** Counts an idle lane more or fewer reaching a subject. */
  private reach(slot: number, by: number): void {
    const i = slot * SLOT + IDLE;
    this.per[i] = (this.per[i] as number) + by;
  }

  private forget(slot: number): void {
    this.live--;
    for (const lane of this.lanes) lane.remove(slot);
    if (slot < this.cap) this.per[slot * SLOT + FILLED] = 0;
    this.subjects[slot] = undefined;
  }

  private grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2, 64);
    const per = new Float64Array(cap * SLOT);
    per.set(this.per);
    this.per = per;
    for (const ch of this.laned) {
      const values = new Float64Array(cap * ch.axes);
      values.set(ch.values);
      ch.values = values;
    }
    this.cap = cap;
  }

  private requalify(version: number): void {
    const host = this.host;
    this.qualifiedVersion = version;
    this.filledVersion = Number.NaN;
    const present = host.voices.filter((v) => v.state !== 'done');
    const numeric = host.channels.map((c) => numericOf(c) !== undefined);
    const { channels, voices } = qualify(
      numeric,
      // A voice writing nothing has no lane to fill, so it stays where its calls are made.
      present.map((v) => ({ id: v.id, fits: v.slots.length > 0 && host.fits(v), slots: v.slots })),
    );
    for (const lane of this.lanes) if (!voices.has(lane.voice.id)) this.leave(lane);
    const kept: Lane<I, O>[] = [];
    for (const v of present) {
      if (!voices.has(v.id)) continue;
      const lane = this.byId.get(v.id) ?? new Lane<I, O>(v);
      v.laned = true;
      if (lane.epoch === 0 && (v.state === 'live' || v.state === 'fading'))
        lane.epoch = ++this.epochs;
      kept.push(lane);
    }
    this.lanes = kept;
    this.runs = kept.filter((l) => !l.solo);
    this.dense = kept
      .filter((l) => l.voice.named === null && l.epoch > 0)
      .sort((a, b) => a.epoch - b.epoch);
    this.whole = kept.length === present.length;
    this.byId.clear();
    for (const lane of kept) this.byId.set(lane.voice.id, lane);
    // With no lane left no fill comes to let go of the subjects the last probes held.
    if (kept.length === 0) this.subjects = [];
    this.laned = [];
    this.bySlot = host.channels.map(() => undefined);
    channels.forEach((on, slot) => {
      if (!on) return;
      const channel = host.channels[slot] as Channel<unknown>;
      const n = numericOf(channel) as Numeric;
      const rest = channel.rest as number | number[];
      const ch: Laned = {
        name: host.names[slot] as string,
        op: n.op,
        rest: typeof rest === 'number' ? rest : (rest[0] as number),
        axes: n.axes,
        values: new Float64Array(this.cap * n.axes),
        start: typeof rest === 'number' ? [] : rest,
      };
      this.laned.push(ch);
      this.bySlot[slot] = ch;
    });
    this.copies.length = 0;
    for (const ch of this.bySlot) this.copies.push(ch !== undefined);
    for (const lane of kept) {
      lane.chans = lane.voice.slots.map((s) => this.bySlot[s] as Laned);
      lane.values = lane.chans.map(() => undefined);
    }
  }

  /** Hands a voice back to the general path, with the weights `weightOf` reports kept on its records. */
  private leave(lane: Lane<I, O>): void {
    if (lane.idle) this.wake(lane);
    for (let p = 0; p < lane.list.length; p++) {
      const rec = lane.records[p];
      const slot = lane.list[p] as number;
      const w = this.reported(lane, slot);
      if (rec !== undefined && w !== undefined) rec.weight = w;
      if (rec !== undefined && lane.motion !== undefined) this.settle(lane, p, slot, rec);
    }
    lane.voice.laned = false;
  }

  private fillAll(now: number, version: number): void {
    const host = this.host;
    this.filling = true;
    try {
      this.fills++;
      this.now = now;
      this.filledAt = now;
      this.filledVersion = version;
      const size = this.numbers.size;
      this.keeps = host.keeps;
      const decide = this.fresh;
      this.fresh = false;
      const share = this.live > 0 ? this.lastDistinct / this.live : 1;
      // One pass, deciding and running each lane, since a mix of many small lanes pays per visit.
      let busy = false;
      for (const lane of this.runs) {
        if (decide) {
          // A lane with few subjects, such as one naming its own, goes by the share of all probed;
          // one with a single subject shares nothing a fill could save, as a solo lane does not.
          const line = lane.line;
          const n = lane.list.length;
          if (n >= 64) this.pace(lane);
          else if (n === 1 && lane.motion === undefined) {
            if (!lane.idle) this.rest(lane);
          } else if (lane.idle ? share >= line.start : share < line.stop) this.flip(lane);
        }
        if (lane.idle) continue;
        if (!busy) {
          busy = true;
          for (const ch of this.laned) ch.values.fill(ch.rest, 0, size * ch.axes);
        }
        this.run(lane);
      }
      // With every lane idle there was nothing to fill, and no subject reads a lane this frame.
      if (busy) for (let s = 0; s < size; s++) this.per[s * SLOT + FILLED] = this.fills;
      for (const slot of this.late) this.per[slot * SLOT + FILLED] = 0;
      if (this.holding) {
        this.subjects.fill(undefined, 0, size);
        this.holding = false;
      }
      this.moved = reading.moved;
    } finally {
      this.filling = false;
      this.late.length = 0;
    }
  }

  /**
   * Sets a lane idle or busy by the share of its subjects probed in the last frame that had a probe,
   * read from about 256 of them a prime stride apart, from an offset that moves each frame, so a host
   * probing every second or third subject is not read as probing all or none. Both paths give the
   * same values, so this only picks the cheaper.
   */
  private pace(lane: Lane<I, O>): void {
    const list = lane.list;
    const line = lane.line;
    const from = this.lastFrom;
    const to = this.lastTo;
    const step = primeFrom(Math.floor(list.length / 256));
    let looked = 0;
    let probed = 0;
    for (let p = this.fills % step; p < list.length; p += step) {
      const slot = list[p] as number;
      const a = this.per[slot * SLOT + LANE_PROBE] as number;
      const b = this.per[slot * SLOT + GENERAL_PROBE] as number;
      if ((a > from && a <= to) || (b > from && b <= to)) probed++;
      looked++;
    }
    const share = probed / looked;
    if (lane.idle ? share >= line.start : share < line.stop) this.flip(lane);
  }

  private flip(lane: Lane<I, O>): void {
    if (lane.idle) this.wake(lane);
    else this.rest(lane);
  }

  /** Leaves a lane's subjects to the general path until it wakes, keeping what `weightOf` reports. */
  private rest(lane: Lane<I, O>): void {
    lane.idle = true;
    const list = lane.list;
    const data = lane.data;
    for (let p = 0; p < list.length; p++) {
      const slot = list[p] as number;
      this.reach(slot, 1);
      // A probe read this subject from the last fill, which this lane's weight stays from.
      if (this.per[slot * SLOT + LANE_FILL] === this.fills - 1) {
        const o = p * STRIDE;
        data[o + PROBED] = data[o + WEIGHT] as number;
      }
    }
  }

  private wake(lane: Lane<I, O>): void {
    lane.idle = false;
    for (const slot of lane.list) this.reach(slot, -1);
  }

  private subjectAt(slot: number): I | typeof absent {
    let subject = this.subjects[slot];
    if (subject === undefined) {
      subject = this.numbers.subject(slot);
      this.subjects[slot] = subject;
      this.holding = true;
    }
    return subject;
  }

  /** One voice's contribution to every subject it plays on. */
  private run(lane: Lane<I, O>): void {
    const voice = lane.voice;
    if (voice.state !== 'live' && voice.state !== 'fading') return;
    lane.placed = false;
    lane.read = false;
    lane.weighed = false;
    // With no fade in or out the envelope is 1 for every subject, which is what it would return.
    lane.flat = !((voice.fade.in ?? 0) > 0) && voice.out === null;
    lane.fade = 1;
    if (lane.motion !== undefined && !voice.keeping) {
      this.runMotion(lane, lane.motion);
      return;
    }
    const elapsed = voice.elapsedAt(this.now);
    const period = voice.patch.period;
    const passes = voice.passes;
    const list = lane.list;
    for (let p = 0; p < list.length; p++) {
      this.one(lane, p, list[p] as number, elapsed, period, passes);
      // Its patch just made kept state: no further call this fill, the general path makes them.
      if (voice.keeping) return;
    }
  }

  private one(
    lane: Lane<I, O>,
    p: number,
    slot: number,
    elapsedNow: number,
    period: number,
    passes: number,
  ): void {
    const host = this.host;
    const voice = lane.voice;
    const data = lane.data;
    const o = p * STRIDE;
    // A probe read this subject from the last fill: keep the weight it read for `weightOf`.
    if (this.per[slot * SLOT + LANE_FILL] === this.fills - 1)
      data[o + PROBED] = data[o + WEIGHT] as number;
    const delay = data[o + DELAY] as number;
    const elapsed = elapsedNow - delay;
    if (elapsed < 0) {
      data[o + WEIGHT] = 0;
      return;
    }
    if (!lane.placed || !Object.is(elapsed, lane.placedAt)) {
      lane.placed = true;
      lane.placedAt = elapsed;
      lane.phase = phaseAt(elapsed, period, passes);
      lane.pass = passAt(elapsed, period, passes);
    }
    const since = data[o + SINCE] as number;
    if (!lane.flat && (!lane.weighed || !Object.is(since, lane.weighedSince))) {
      lane.fade = host.envelope(voice, since);
      lane.weighed = true;
      lane.weighedSince = since;
    }
    let w = clampWeight(voice.weight * lane.fade);
    if (voice.parts !== null) {
      const subject = this.subjectAt(slot);
      if (subject !== absent) w *= host.parting(voice, subject);
    }
    data[o + WEIGHT] = w;
    if (voice.built !== null) {
      if (!lane.read || !Object.is(elapsed, lane.readAt)) {
        readKeys(
          voice.built,
          lane.phase,
          lane.delta,
          undefined,
          voice.lerps as never,
          undefined,
          voice.intos,
          lane.scratch,
        );
        lane.read = true;
        lane.readAt = elapsed;
        this.gather(lane, lane.delta);
      }
      if (w > 0) this.fold(lane, slot, w);
      return;
    }
    const held = lane.records[p] as Subject<unknown>;
    // The general path makes a voice's first call for a subject, where it first sees it play.
    if (Number.isNaN(held.probed)) {
      this.late.push(slot);
      return;
    }
    // A motion patch needs the subject only to number it, so the lookup waits until then.
    if (lane.motion !== undefined) {
      this.move(lane, lane.motion, p, slot, held, elapsed, delay, w);
      return;
    }
    const subject = this.subjectAt(slot);
    if (subject === absent) return;
    // Called already this frame, by the general path or a fill before a refill: reuse, as a probe does.
    if (held.probed === this.now && held.delta !== null && held.seeks === voice.seeks) {
      if (w > 0) this.foldDelta(lane, slot, held.delta, w);
      return;
    }
    const kept = reading.kept;
    host.ready(voice, subject, held, elapsed, lane.pass, w);
    host.horizon(voice, delay);
    const delta = voice.patch.at(lane.phase, subject, voice.setting as never) as Record<
      string,
      unknown
    >;
    // What `influence` leaves on the record, so a probe on the general path this frame reuses it.
    held.delta = delta;
    held.probed = this.now;
    held.seeks = voice.seeks;
    if (this.keeps) host.after(voice, held);
    if (reading.kept !== kept && !voice.keeping) host.kept(voice);
    if (w > 0) this.foldDelta(lane, slot, delta, w);
  }

  /**
   * A motion voice's fill: what `one` and `move` do for each subject, in one loop for the common
   * case, a subject not yet probed this frame with nothing pending, and through `move` for the rest.
   */
  private runMotion(lane: Lane<I, O>, run: Motions<I>): void {
    const voice = lane.voice;
    const data = lane.data;
    const per = this.per;
    const list = lane.list;
    const records = lane.records;
    const ch = lane.chans[0] as Laned;
    const fills = this.fills;
    const from = this.frameProbes;
    const seeks = voice.seeks;
    const elapsedNow = voice.elapsedAt(this.now);
    const flat = lane.flat;
    const parts = voice.parts !== null;
    const n = run.n;
    if (n > 0) {
      if (lane.axes !== n) {
        lane.axes = n;
        lane.samples = new Float64Array(0);
      }
      if (list.length * n > lane.samples.length) {
        const grown = new Float64Array(Math.max(list.length, (lane.samples.length / n) * 2, 4) * n);
        grown.set(lane.samples);
        lane.samples = grown;
      }
    }
    const samples = lane.samples;
    const xs = run.xs;
    for (let p = 0; p < list.length; p++) {
      const slot = list[p] as number;
      const o = p * STRIDE;
      const q = slot * SLOT;
      if (per[q + LANE_FILL] === fills - 1) data[o + PROBED] = data[o + WEIGHT] as number;
      const delay = data[o + DELAY] as number;
      const elapsed = elapsedNow - delay;
      if (elapsed < 0) {
        data[o + WEIGHT] = 0;
        continue;
      }
      if (!flat) {
        const since = data[o + SINCE] as number;
        if (!lane.weighed || !Object.is(since, lane.weighedSince)) {
          lane.fade = this.host.envelope(voice, since);
          lane.weighed = true;
          lane.weighedSince = since;
        }
      }
      let w = clampWeight(voice.weight * lane.fade);
      if (parts) {
        const subject = this.subjectAt(slot);
        if (subject !== absent) w *= this.host.parting(voice, subject);
      }
      data[o + WEIGHT] = w;
      const held = records[p] as Subject<unknown>;
      if (Number.isNaN(held.probed)) {
        this.late.push(slot);
        continue;
      }
      const ms = data[o + MSLOT] as number;
      if (
        ms < 0 ||
        (per[q + LANE_PROBE] as number) > from ||
        (per[q + GENERAL_PROBE] as number) > from ||
        !run.sampleBare(ms, elapsed, xs, run.vs)
      ) {
        this.move(lane, run, p, slot, held, elapsed, delay, w);
        continue;
      }
      for (let a = 0; a < n; a++) samples[p * n + a] = xs[a] as number;
      lane.deltas[p] = null;
      data[o + SAMPLED] = fills;
      data[o + SEEKS] = seeks;
      if (w <= 0) continue;
      if (n === ch.axes && run.scalar(ms) === (ch.axes === 1)) this.foldRun(ch, slot, xs, w);
      else this.foldInto(ch, slot, run.value(ms, xs), w);
    }
  }

  /**
   * A motion voice's value for a subject, sampled from the patch's state as its `at` would, but only
   * where that sample changes nothing: one with a change to stamp, commit or let go of goes to the
   * general path, which samples it if and when a probe asks, as it would with no lanes. A probe
   * this frame already read keeps the value it read, as the general path's record would.
   */
  private move(
    lane: Lane<I, O>,
    run: Motions<I>,
    p: number,
    slot: number,
    held: Subject<unknown>,
    elapsed: number,
    delay: number,
    w: number,
  ): void {
    const voice = lane.voice;
    const data = lane.data;
    const o = p * STRIDE;
    const ch = lane.chans[0] as Laned;
    this.settle(lane, p, slot, held);
    const delta = held.delta;
    if (
      delta === null ||
      held.probed !== this.now ||
      held.seeks !== voice.seeks ||
      !this.probedThisFrame(slot)
    ) {
      let ms = data[o + MSLOT] as number;
      if (ms < 0) {
        const subject = this.subjectAt(slot);
        if (subject === absent) return;
        ms = run.slot(subject);
        data[o + MSLOT] = ms;
      }
      this.host.horizon(voice, delay);
      if (!run.quiet(ms, elapsed)) {
        this.late.push(slot);
        return;
      }
      run.sample(ms, elapsed, run.xs, run.vs);
      // Kept as numbers, not a delta: one is built only if a probe this frame asks for it.
      const n = run.n;
      if (lane.axes !== n) {
        lane.axes = n;
        lane.samples = new Float64Array(0);
      }
      if ((p + 1) * n > lane.samples.length) {
        const grown = new Float64Array(Math.max(p + 1, (lane.samples.length / n) * 2, 4) * n);
        grown.set(lane.samples);
        lane.samples = grown;
      }
      for (let a = 0; a < n; a++) lane.samples[p * n + a] = run.xs[a] as number;
      lane.deltas[p] = null;
      data[o + SAMPLED] = this.fills;
      data[o + SEEKS] = voice.seeks;
      if (w <= 0) return;
      // A sample of other axes than the channel's folds as the general path folds it.
      if (n === ch.axes && run.scalar(ms) === (ch.axes === 1)) this.foldRun(ch, slot, run.xs, w);
      else this.foldInto(ch, slot, run.value(ms, run.xs), w);
      return;
    }
    lane.deltas[p] = delta;
    data[o + SAMPLED] = this.fills;
    data[o + SEEKS] = voice.seeks;
    if (w > 0) this.foldInto(ch, slot, delta[ch.name], w);
  }

  /** The delta a motion voice's last sample for position `p` made, built from `samples`. */
  private sampled(lane: Lane<I, O>, p: number): Record<string, unknown> {
    const run = lane.motion as Motions<I>;
    const n = lane.axes;
    for (let a = 0; a < n; a++) run.xs[a] = lane.samples[p * n + a] as number;
    const ms = lane.data[p * STRIDE + MSLOT] as number;
    const delta = { [(lane.chans[0] as Laned).name]: run.value(ms, run.xs) };
    lane.deltas[p] = delta;
    return delta;
  }

  /**
   * A probe this frame read a motion voice's value for the subject from an earlier fill: write onto
   * its record what the general path's sample would have, so a later read this frame reuses it.
   */
  private settle(lane: Lane<I, O>, p: number, slot: number, held: Subject<unknown>): void {
    const o = p * STRIDE;
    if (
      (held.probed === this.now && held.seeks === lane.data[o + SEEKS]) ||
      !((this.per[slot * SLOT + LANE_PROBE] as number) > this.frameProbes) ||
      lane.data[o + SAMPLED] !== this.per[slot * SLOT + LANE_FILL]
    )
      return;
    held.delta = lane.deltas[p] ?? this.sampled(lane, p);
    held.probed = this.now;
    held.seeks = lane.data[o + SEEKS] as number;
  }

  /** For a keys voice: the delta's value for each channel it writes, read once per phase. */
  private gather(lane: Lane<I, O>, delta: Record<string, unknown>): void {
    const chans = lane.chans;
    for (let i = 0; i < chans.length; i++) lane.values[i] = delta[(chans[i] as Laned).name];
  }

  /** Folds what `gather` read into a subject's laned values. */
  private fold(lane: Lane<I, O>, slot: number, w: number): void {
    const chans = lane.chans;
    for (let i = 0; i < chans.length; i++)
      this.foldInto(chans[i] as Laned, slot, lane.values[i], w);
  }

  /**
   * Folds a delta a patch returned into a subject's laned values. The first few channels are read
   * at a site of their own, which in most mixes sees one channel name and stays fast, where one
   * site reading every name in turn slows every read.
   */
  private foldDelta(
    lane: Lane<I, O>,
    slot: number,
    delta: Record<string, unknown>,
    w: number,
  ): void {
    const chans = lane.chans;
    const n = chans.length;
    let ch = chans[0] as Laned;
    if (n > 0) this.foldInto(ch, slot, delta[ch.name], w);
    ch = chans[1] as Laned;
    if (n > 1) this.foldInto(ch, slot, delta[ch.name], w);
    ch = chans[2] as Laned;
    if (n > 2) this.foldInto(ch, slot, delta[ch.name], w);
    for (let i = 3; i < n; i++) {
      ch = chans[i] as Laned;
      this.foldInto(ch, slot, delta[ch.name], w);
    }
  }

  /** Folds a motion sample's axes, kept apart from `foldInto` so neither reads two array kinds. */
  private foldRun(ch: Laned, slot: number, xs: Float64Array, w: number): void {
    const values = ch.values;
    const base = slot * ch.axes;
    for (let a = 0; a < ch.axes; a++)
      values[base + a] = foldNumber(ch.op, values[base + a] as number, xs[a] as number, w);
  }

  private foldInto(ch: Laned, slot: number, value: unknown, w: number): void {
    if (value === undefined) return;
    const values = ch.values;
    if (ch.axes === 1) {
      values[slot] = foldNumber(ch.op, values[slot] as number, value as number, w);
      return;
    }
    const base = slot * ch.axes;
    // Indexed as `vec`'s fold indexes it, so a typed array folds as an array does.
    const arr =
      Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<number>) : null;
    for (let a = 0; a < ch.axes; a++) {
      const v = arr === null ? ch.rest : (arr[a] ?? ch.rest);
      values[base + a] = foldNumber(ch.op, values[base + a] as number, v, w);
    }
  }
}
