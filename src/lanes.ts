import { foldNumber, type Numeric, numericOf } from './channels.js';
import { clampWeight, passesOf, place, placed } from './clock.js';
import type { Subject, Voice } from './mixer.js';
import { absent, Numbers } from './numbers.js';
import { readKeys, type Scratch } from './patch.js';
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
}

const STRIDE = 5;
const DELAY = 0;
const SINCE = 1;
/** The weight the last fill gave the subject. */
const WEIGHT = 2;
/** The weight a fill gave it the last time a probe read it from the lane. */
const PROBED = 3;
const MSLOT = 4;

/**
 * What one laned voice keeps per subject it reaches, by position in `list`. A subject gets a
 * position when a probe of it first finds the voice playing, which is when the general path first
 * sees it too.
 */
class Lane<I, O> {
  /** The subject number at each position. */
  readonly list: number[] = [];
  private readonly at = new Map<number, number>();
  /**
   * When the voice started playing on its lane, in the order lanes did; 0 while it waits. A subject
   * checked against every lane up to some epoch has met this one if this one's is no later.
   */
  epoch = 0;
  /**
   * Per position, `STRIDE` numbers side by side, so one subject's are one read from memory: its
   * delay, its `since`, its weight at the last fill, its weight at the last fill a probe read, and a
   * motion patch's own number for it (-1 until asked).
   */
  data = new Float64Array(0);
  records: (Subject<unknown> | undefined)[] = [];
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

  constructor(readonly voice: Voice<I, O>) {}

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
    this.records[p] = held;
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
    }
    this.list.pop();
    this.at.delete(slot);
    this.records[last] = undefined;
  }
}

/**
 * The lanes of one mix: subject numbers, which channels and voices run on lanes, and the values a
 * frame's fill leaves for probes to copy.
 */
export class Lanes<I, O> {
  readonly numbers: Numbers<I>;
  private lanes: Lane<I, O>[] = [];
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
  /** Per subject number, which fill last wrote it; 0 for none. */
  private filled = new Uint32Array(0);
  private fills = 0;
  /** Per subject number, the latest lane epoch a probe of it has checked it against. */
  private seen = new Uint32Array(0);
  /**
   * Per subject number, the probe count at its last probe read from the lanes and at its last probe
   * folded by the general path, and the fill the former read: which of a lane and a record holds
   * the weight `weightOf` reports.
   */
  private laneProbe = new Float64Array(0);
  private generalProbe = new Float64Array(0);
  private laneFill = new Uint32Array(0);
  private probes = 0;
  /**
   * Each subject by number as last probed, held from that probe until the next fill uses it, so a
   * fill rarely looks one up through its weak reference, which costs on every look. A host that
   * stops syncing keeps at most one frame's probed subjects alive until its next fill, and none
   * once no lane remains.
   */
  private subjects: (I | typeof absent | undefined)[] = [];
  /** While a fill runs, so a probe a patch makes from inside it takes the general path. */
  private filling = false;
  /** Numbers handed out while a fill ran, which that fill did not fill. */
  private readonly late: number[] = [];
  private keeps = false;
  private now = Number.NaN;
  private filledAt = Number.NaN;
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
    this.grow(slot + 1);
    this.filled[slot] = 0;
    this.seen[slot] = 0;
    this.laneProbe[slot] = 0;
    this.generalProbe[slot] = 0;
    this.laneFill[slot] = 0;
    if (this.filling) this.late.push(slot);
    return slot;
  }

  release(slot: number): void {
    this.numbers.release(slot);
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
    if (!((this.laneProbe[slot] as number) > (this.generalProbe[slot] as number))) return undefined;
    const p = lane.positionOf(slot);
    if (p < 0) return undefined;
    return lane.data[p * STRIDE + (this.laneFill[slot] === this.fills ? WEIGHT : PROBED)];
  }

  /**
   * Fills the lanes once a frame, and says whether this probe of a subject reads its values from
   * them. One that a lane has not met yet, newly numbered or newly reached, takes the general path
   * this frame, which is where it is first seen; so does one probed from inside a fill.
   */
  prepare(slot: number, subject: I, now: number, version: number): boolean {
    if (this.filling) {
      if (slot >= 0) this.generalProbe[slot] = ++this.probes;
      return false;
    }
    if (this.qualifiedVersion !== version) this.requalify(version);
    if (this.laned.length === 0) return false;
    if (this.filledAt !== now || this.filledVersion !== version) this.fillAll(now, version);
    if (slot < 0) return false;
    this.subjects[slot] = subject;
    const probe = ++this.probes;
    let lane = this.filled[slot] === this.fills;
    if ((this.seen[slot] as number) < this.epochs && this.meet(slot, subject)) {
      // The fill ran before the subject had these positions, so it reads the general path all frame.
      this.filled[slot] = 0;
      lane = false;
    }
    if (lane) {
      this.laneProbe[slot] = probe;
      this.laneFill[slot] = this.fills;
    } else this.generalProbe[slot] = probe;
    return lane;
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
      const arr: number[] = [];
      const base = slot * axes;
      for (let a = 0; a < axes; a++) arr.push(ch.values[base + a] as number);
      pose[ch.name] = arr;
    }
  }

  /**
   * Gives a probed subject a position on every lane that started playing since the subject was last
   * checked and that reaches it. True when any did, so the probe takes the general path.
   */
  private meet(slot: number, subject: I): boolean {
    const from = this.seen[slot] as number;
    this.seen[slot] = this.epochs;
    let met = false;
    const dense = this.dense;
    for (let i = dense.length - 1; i >= 0; i--) {
      const lane = dense[i] as Lane<I, O>;
      if (lane.epoch <= from) break;
      const held = this.host.meet(lane.voice, subject);
      if (!held.reaches) continue;
      lane.add(slot, held);
      met = true;
    }
    const naming = this.host.naming(subject);
    if (naming !== undefined)
      for (const voice of naming) {
        const lane = this.byId.get(voice.id);
        if (lane === undefined || lane.epoch <= from || lane.positionOf(slot) >= 0) continue;
        lane.add(slot, this.host.meet(voice, subject));
        met = true;
      }
    return met;
  }

  private forget(slot: number): void {
    for (const lane of this.lanes) lane.remove(slot);
    if (slot < this.filled.length) this.filled[slot] = 0;
    this.subjects[slot] = undefined;
  }

  private grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2, 64);
    const filled = new Uint32Array(cap);
    filled.set(this.filled);
    this.filled = filled;
    const seen = new Uint32Array(cap);
    seen.set(this.seen);
    this.seen = seen;
    const laneFill = new Uint32Array(cap);
    laneFill.set(this.laneFill);
    this.laneFill = laneFill;
    const laneProbe = new Float64Array(cap);
    laneProbe.set(this.laneProbe);
    this.laneProbe = laneProbe;
    const generalProbe = new Float64Array(cap);
    generalProbe.set(this.generalProbe);
    this.generalProbe = generalProbe;
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
      const n = numericOf(host.channels[slot] as Channel<unknown>) as Numeric;
      const ch: Laned = {
        name: host.names[slot] as string,
        op: n.op,
        rest: n.rest,
        axes: n.axes,
        values: new Float64Array(this.cap * n.axes),
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
    for (let p = 0; p < lane.list.length; p++) {
      const rec = lane.records[p];
      const w = this.reported(lane, lane.list[p] as number);
      if (rec !== undefined && w !== undefined) rec.weight = w;
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
      for (const ch of this.laned) ch.values.fill(ch.rest, 0, size * ch.axes);
      for (const lane of this.lanes) this.run(lane);
      this.filled.fill(this.fills, 0, size);
      for (const slot of this.late) this.filled[slot] = 0;
      this.subjects.fill(undefined, 0, size);
    } finally {
      this.filling = false;
      this.late.length = 0;
    }
  }

  private subjectAt(slot: number): I | typeof absent {
    let subject = this.subjects[slot];
    if (subject === undefined) {
      subject = this.numbers.subject(slot);
      this.subjects[slot] = subject;
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
    const elapsed = voice.elapsedAt(this.now);
    const period = voice.patch.period;
    const passes = passesOf(voice.spec.loop);
    const list = lane.list;
    for (let p = 0; p < list.length; p++)
      this.one(lane, p, list[p] as number, elapsed, period, passes);
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
    if (this.laneFill[slot] === this.fills - 1) data[o + PROBED] = data[o + WEIGHT] as number;
    const delay = data[o + DELAY] as number;
    const elapsed = elapsedNow - delay;
    if (elapsed < 0) {
      data[o + WEIGHT] = 0;
      return;
    }
    if (!lane.placed || !Object.is(elapsed, lane.placedAt)) {
      place(elapsed, period, passes);
      lane.placed = true;
      lane.placedAt = elapsed;
      lane.phase = placed.phase;
      lane.pass = placed.pass;
    }
    const since = data[o + SINCE] as number;
    if (!lane.flat && (!lane.weighed || !Object.is(since, lane.weighedSince))) {
      lane.fade = host.envelope(voice, since);
      lane.weighed = true;
      lane.weighedSince = since;
    }
    const w = clampWeight(voice.weight * lane.fade);
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
    const subject = this.subjectAt(slot);
    if (subject === absent) return;
    const held = lane.records[p] as Subject<unknown>;
    host.ready(voice, subject, held, elapsed, lane.pass, w);
    host.horizon(voice, delay);
    const delta = voice.patch.at(lane.phase, subject, voice.setting as never) as Record<
      string,
      unknown
    >;
    if (this.keeps) host.after(voice, held);
    if (held.kept.size > 0 && !voice.keeping) host.kept(voice);
    if (w > 0) this.foldDelta(lane, slot, delta, w);
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

  private foldInto(ch: Laned, slot: number, value: unknown, w: number): void {
    if (value === undefined) return;
    const values = ch.values;
    if (ch.axes === 1) {
      values[slot] = foldNumber(ch.op, values[slot] as number, value as number, w);
      return;
    }
    const base = slot * ch.axes;
    const arr = Array.isArray(value) ? (value as number[]) : null;
    for (let a = 0; a < ch.axes; a++) {
      const v = arr === null ? ch.rest : (arr[a] ?? ch.rest);
      values[base + a] = foldNumber(ch.op, values[base + a] as number, v, w);
    }
  }
}
