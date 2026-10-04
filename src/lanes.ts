import { foldNumber, type Numeric, numericOf } from './channels.js';
import { clampWeight, passAt, phaseAt } from './clock.js';
import type { Curve } from './easing.js';
import type { Subject, Voice } from './mixer.js';
import { closed, type Motions, motionOf, noTouch } from './motion.js';
import { absent, Numbers } from './numbers.js';
import { type Flat, flatOf, readFlat, readKeys, type Scratch } from './patch.js';
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
  /** Its value is a number, its rest a number; otherwise an array, which `vec(1)` is too. */
  scalar: boolean;
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

const STRIDE = 8;
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
/** 1 once the general path has made the voice's first call for the subject, which never undoes. */
const MET = 7;

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

/** What pacing reads and sets: a lane's or a crowd's subjects, idle state and per-position numbers. */
interface Paced {
  list: number[];
  idle: boolean;
  readonly line: { stop: number; start: number };
  data: Float64Array;
}

/**
 * Where a motion voice's per-subject numbers live, by position: a lane of one voice, or the crowd
 * of single-subject motion voices, whose positions each belong to a voice of their own.
 */
export interface Positions<I, O> {
  /** `STRIDE` numbers per position. */
  data: Float64Array;
  /** Each position's last delta, built from its kept sample only when asked. */
  deltas: (Record<string, unknown> | null)[];
  /** Keeps a position's sample, `n` numbers from `xs`. */
  keep(p: number, xs: Float64Array, n: number): void;
  /** Reads a position's kept sample back into `xs`. */
  kept(p: number, xs: Float64Array): void;
  chans: Laned[];
  voiceAt(p: number): Voice<I, O>;
  motionAt(p: number): Motions<I> | undefined;
}

/**
 * What one laned voice keeps per subject it reaches, by position in `list`. A subject gets a
 * position when a probe of it first finds the voice playing, which is when the general path first
 * sees it too.
 */
class Lane<I, O> implements Positions<I, O> {
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

  voiceAt(): Voice<I, O> {
    return this.voice;
  }

  keep(p: number, xs: Float64Array, n: number): void {
    if (this.axes !== n) {
      this.axes = n;
      this.samples = new Float64Array(0);
    }
    if ((p + 1) * n > this.samples.length) {
      const grown = new Float64Array(Math.max(p + 1, (this.samples.length / n) * 2, 4) * n);
      grown.set(this.samples);
      this.samples = grown;
    }
    for (let a = 0; a < n; a++) this.samples[p * n + a] = xs[a] as number;
  }

  kept(p: number, xs: Float64Array): void {
    const n = this.axes;
    for (let a = 0; a < n; a++) xs[a] = this.samples[p * n + a] as number;
  }

  motionAt(): Motions<I> | undefined {
    return this.motion;
  }

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
    this.data[o + SINCE] = held.shown;
    this.data[o + WEIGHT] = 0;
    this.data[o + PROBED] = 0;
    this.data[o + MSLOT] = -1;
    this.data[o + SAMPLED] = -1;
    this.data[o + MET] = 0;
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

/** Whether a laned voice belongs in a crowd: one naming a single subject and writing one channel. */
function crowdable<I, O>(v: Voice<I, O>): boolean {
  return v.named !== null && v.named.size === 1 && v.slots.length === 1;
}

/**
 * A subject's voice time once its voice's holds apply: held at 0 before it starts and at the end of
 * its passes after, and NaN where it shows nothing.
 */
function held<I, O>(voice: Voice<I, O>, elapsed: number): number {
  if (elapsed < 0) return voice.holdsBefore ? 0 : Number.NaN;
  return voice.holdsAfter && elapsed > voice.span ? voice.span : elapsed;
}

/** The law of a row that has none, a keys or fn voice's. */
const none = new Float64Array(0);

/** Per row of a crowd's `hot`: what the fill reads of the row's voice and its current stretch. */
const H_FLAGS = 0;
const H_NOW = 1;
const H_ELAPSED = 2;
const H_RATE = 3;
/** The voice's weight, held to 0..1. */
const H_WEIGHT = 4;
const H_SEEKS = 5;
const H_EPOCH = 6;
const H_ID = 7;
const H_AT = 8;
const H_MS = 9;
/** `x0`, `v0` and `to`, `axes` numbers each. */
const H_X0 = 10;

/** The voice is playing: live, held or fading. */
const F_PLAYING = 1;
/** Its weight and clock are `hot`'s: no fade in or out, rate ramp, subject ramp or kept state. */
const F_FAST = 2;
/** Its stretch changed since `hot` copied it. */
const F_STALE = 4;
/** `hot` holds its stretch, with nothing pending and no earlier stretch kept. */
const F_BARE = 8;
/** A probe has met its subject, so its per-subject numbers are set. */
const F_PLACED = 16;
/** Its samples fold as the channel's axes, a number for a number and an array for an array. */
const F_FOLDS = 32;
/** Something on the voice changed since `hot` copied it. */
const F_VOICE = 64;
/** The row's voice is a motion voice; otherwise its patch is keys or a stateless fn. */
const F_MOTION = 128;
/** The voice holds before or after, so its clock is read from the voice. */
const F_HOLDS = 256;

/**
 * Every laned voice on one channel that reaches a single subject, a row each, in voice order: the
 * per-subject numbers a lane keeps, and a copy of what a fill reads of the voice and, for a motion
 * voice, its patch, so a fill over 100k of them reads a few flat arrays instead of 100k voices,
 * lanes and patch buffers. Each copy is written when its source changes: the voice's by
 * `voiceChanged`, the stretch through the patch's `touched`.
 */
class Crowd<I, O> implements Positions<I, O> {
  /** The subject number at each row. */
  list: number[] = [];
  /** `STRIDE` numbers per row, laid out as a lane's. */
  data = new Float64Array(0);
  hot = new Float64Array(0);
  readonly stride: number;
  samples = new Float64Array(0);
  deltas: (Record<string, unknown> | null)[] = [];
  records: (Subject<unknown> | undefined)[] = [];
  voices: Voice<I, O>[] = [];
  motions: (Motions<I> | undefined)[] = [];
  eases: (Curve | undefined)[] = [];
  /** Each row's patch law, one array shared by every row whose law is the same. */
  laws: Float64Array[] = [];
  /** For a keys row whose stops read as numbers, those numbers; null for any other row. */
  flats: (Flat | null)[] = [];
  touches: ((s: number) => void)[] = [];
  readonly rowOf = new Map<number, number>();
  idle = false;
  readonly line = SPARSE.other;
  /** Where the fill now under way has reached. */
  cursor = 0;
  readonly xs: Float64Array;
  readonly vs: Float64Array;
  /** What a keys row reads into, folded before the next row reads. */
  readonly delta: Record<string, unknown> = {};
  readonly scratch: Scratch = [];

  constructor(
    readonly chans: Laned[],
    readonly axes: number,
  ) {
    this.stride = H_X0 + 3 * axes;
    this.xs = new Float64Array(axes);
    this.vs = new Float64Array(axes);
  }

  voiceAt(p: number): Voice<I, O> {
    return this.voices[p] as Voice<I, O>;
  }

  /** Samples of another width than the channel's, which `samples` cannot hold, by row. */
  odd: Map<number, Float64Array> | null = null;

  keep(p: number, xs: Float64Array, n: number): void {
    if (n === this.axes) {
      for (let a = 0; a < n; a++) this.samples[p * n + a] = xs[a] as number;
      this.odd?.delete(p);
      return;
    }
    this.odd ??= new Map();
    this.odd.set(p, xs.slice(0, n));
  }

  kept(p: number, xs: Float64Array): void {
    const odd = this.odd?.get(p);
    if (odd !== undefined) {
      xs.set(odd);
      return;
    }
    const n = this.axes;
    for (let a = 0; a < n; a++) xs[a] = this.samples[p * n + a] as number;
  }

  motionAt(p: number): Motions<I> | undefined {
    return this.motions[p];
  }

  get size(): number {
    return this.list.length;
  }

  /** Makes room for `rows` rows. */
  reserve(rows: number): void {
    if (rows * STRIDE <= this.data.length) return;
    const cap = Math.max(rows, (this.data.length / STRIDE) * 2, 16);
    const data = new Float64Array(cap * STRIDE);
    data.set(this.data);
    this.data = data;
    const hot = new Float64Array(cap * this.stride);
    hot.set(this.hot);
    this.hot = hot;
    const samples = new Float64Array(cap * this.axes);
    samples.set(this.samples);
    this.samples = samples;
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
  /** The crowds of single-subject motion voices, one per channel, and which holds each voice. */
  private crowds: Crowd<I, O>[] = [];
  private readonly crowdOf = new Map<number, Crowd<I, O>>();
  private readonly lawsByKey = new Map<string, Float64Array>();
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
  /** What `writeLater` has queued: lane slots and the rows they go to, for one set of columns. */
  private queueSlots = new Int32Array(0);
  private queueRows = new Int32Array(0);
  private queued = 0;
  private inOrder = true;
  private queuedFor: readonly Column[] | null = null;
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
    if (lane !== undefined) {
      if (lane.positionOf(slot) < 0) return;
      if (lane.idle) this.reach(slot, -1);
      lane.remove(slot);
      return;
    }
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c !== undefined && p !== undefined && c.list[p] === slot) this.unplace(c, p);
  }

  /** Takes a crowd row off its subject, to be placed again if a probe meets it again. */
  private unplace(c: Crowd<I, O>, p: number): void {
    const slot = c.list[p] as number;
    if (c.idle && slot >= 0) this.reach(slot, -1);
    c.list[p] = -1;
    c.records[p] = undefined;
    c.deltas[p] = null;
    const f = p * c.stride + H_FLAGS;
    c.hot[f] = (c.hot[f] as number) & ~F_PLACED;
    const o = p * STRIDE;
    c.data[o + MSLOT] = -1;
    c.data[o + SAMPLED] = -1;
    c.data[o + MET] = 0;
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
    if (slot < 0) return undefined;
    const lane = this.byId.get(id);
    if (lane !== undefined) return this.reported(lane, slot);
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    return c === undefined || p === undefined ? undefined : this.reportedRow(c, p, slot);
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
    if (this.runs.length === 0 && this.crowds.length === 0) {
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
   * Queues a subject's values for each column at subject `n`'s places, for a `pull` that reads
   * from the lanes while every voice is on one; `flush` writes what is queued, column by column. A
   * channel no lane holds is at rest. Anything queued is written before the lanes fill again.
   */
  writeLater(slot: number, columns: readonly Column[], n: number): void {
    if (columns !== this.queuedFor) {
      this.flush();
      this.queuedFor = columns;
    }
    const k = this.queued;
    if (k === this.queueSlots.length) {
      const slots = new Int32Array(Math.max(64, k * 2));
      slots.set(this.queueSlots);
      this.queueSlots = slots;
      const rows = new Int32Array(slots.length);
      rows.set(this.queueRows);
      this.queueRows = rows;
    }
    this.queueSlots[k] = slot;
    this.queueRows[k] = n;
    if (
      k > 0 &&
      (slot !== (this.queueSlots[k - 1] as number) + 1 ||
        n !== (this.queueRows[k - 1] as number) + 1)
    )
      this.inOrder = false;
    this.queued = k + 1;
  }

  flush(): void {
    const count = this.queued;
    const columns = this.queuedFor;
    if (count === 0 || columns === null) return;
    this.queued = 0;
    // Subjects numbered in the order the host lists them: each column is one block.
    const block = this.inOrder;
    this.inOrder = true;
    const slots = this.queueSlots;
    const rows = this.queueRows;
    for (let k = 0; k < columns.length; k++) {
      const c = columns[k] as Column;
      const axes = c.axes;
      const out = c.out;
      const ch = this.bySlot[c.slot];
      if (ch === undefined) {
        for (let i = 0; i < count; i++) {
          const at = (rows[i] as number) * axes;
          for (let a = 0; a < axes; a++) out[at + a] = c.rest[a] as number;
        }
        continue;
      }
      const values = ch.values;
      if (block) {
        const s0 = (slots[0] as number) * axes;
        out.set(values.subarray(s0, s0 + count * axes), (rows[0] as number) * axes);
      } else if (axes === 1) {
        for (let i = 0; i < count; i++)
          out[rows[i] as number] = values[slots[i] as number] as number;
      } else
        for (let i = 0; i < count; i++) {
          const at = (rows[i] as number) * axes;
          const base = (slots[i] as number) * axes;
          for (let a = 0; a < axes; a++) out[at + a] = values[base + a] as number;
        }
      if (c.bounds !== undefined)
        for (let i = 0; i < count; i++) clampRun(out, (rows[i] as number) * axes, axes, c.bounds);
    }
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
        if (lane === undefined) {
          if (this.place(voice, slot, subject, from)) met = true;
          continue;
        }
        if (lane.epoch <= from || lane.positionOf(slot) >= 0) continue;
        const held = this.host.meet(voice, subject);
        if (!held.reaches) continue;
        lane.add(slot, held);
        if (lane.idle) this.reach(slot, 1);
        met = true;
      }
    return met;
  }

  /** Places a crowd voice's row on the subject a probe met, as `Lane.add` adds a position. */
  private place(voice: Voice<I, O>, slot: number, subject: I, from: number): boolean {
    const c = this.crowdOf.get(voice.id);
    const p = c?.rowOf.get(voice.id);
    if (c === undefined || p === undefined) return false;
    const h = p * c.stride;
    const flags = c.hot[h + H_FLAGS] as number;
    if ((c.hot[h + H_EPOCH] as number) <= from || (flags & F_PLACED) !== 0) return false;
    const held = this.host.meet(voice, subject);
    if (!held.reaches) return false;
    const o = p * STRIDE;
    c.list[p] = slot;
    c.data[o + DELAY] = held.delay;
    c.data[o + SINCE] = held.shown;
    c.data[o + WEIGHT] = 0;
    c.data[o + PROBED] = 0;
    c.data[o + MSLOT] = -1;
    c.data[o + SAMPLED] = -1;
    c.data[o + MET] = 0;
    c.records[p] = held;
    c.deltas[p] = null;
    c.hot[h + H_FLAGS] = flags | F_PLACED | F_STALE;
    if (c.idle) this.reach(slot, 1);
    return true;
  }

  /** Counts an idle lane more or fewer reaching a subject. */
  private reach(slot: number, by: number): void {
    const i = slot * SLOT + IDLE;
    this.per[i] = (this.per[i] as number) + by;
  }

  private forget(slot: number): void {
    this.live--;
    for (const lane of this.lanes) lane.remove(slot);
    for (const c of this.crowds)
      for (let p = 0; p < c.size; p++) if (c.list[p] === slot) this.unplace(c, p);
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
    this.flush();
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
    let crowded = 0;
    for (const v of present) {
      if (!voices.has(v.id)) continue;
      if (crowdable(v)) {
        crowded++;
        continue;
      }
      const lane = this.byId.get(v.id) ?? new Lane<I, O>(v);
      v.laned = true;
      if (lane.epoch === 0 && v.state !== 'pending') lane.epoch = ++this.epochs;
      kept.push(lane);
    }
    this.lanes = kept;
    this.runs = kept.filter((l) => !l.solo);
    this.dense = kept
      .filter((l) => l.voice.named === null && l.epoch > 0)
      .sort((a, b) => a.epoch - b.epoch);
    this.whole = kept.length + crowded === present.length;
    this.byId.clear();
    for (const lane of kept) this.byId.set(lane.voice.id, lane);
    // With no lane left no fill comes to let go of the subjects the last probes held.
    if (kept.length === 0 && crowded === 0) this.subjects = [];
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
        scalar: typeof rest === 'number',
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
    this.regroup(present.filter((v) => voices.has(v.id) && crowdable(v)));
  }

  /**
   * Rebuilds the crowds from the voices that belong in one, in voice order: a voice already in a
   * crowd keeps its row's numbers, a new one gets a row a probe will place, and a voice no longer in
   * one is handed back to the general path, as a lane's voice is when it leaves.
   */
  private regroup(members: Voice<I, O>[]): void {
    const keep = new Set(members.map((v) => v.id));
    for (const c of this.crowds)
      for (let p = 0; p < c.size; p++) {
        const v = c.voices[p] as Voice<I, O>;
        if (!keep.has(v.id) || v.state === 'done') this.leaveCrowd(c, p);
      }
    const bySlot = new Map<number, Crowd<I, O>>();
    const crowds: Crowd<I, O>[] = [];
    const was = this.crowdOf;
    const next = new Map<number, Crowd<I, O>>();
    for (const v of members) {
      const slot = v.slots[0] as number;
      let c = bySlot.get(slot);
      if (c === undefined) {
        const ch = this.bySlot[slot] as Laned;
        c = new Crowd<I, O>([ch], ch.axes);
        const old = this.crowds.find((o) => o.chans[0]?.name === ch.name);
        if (old !== undefined) c.idle = old.idle;
        bySlot.set(slot, c);
        crowds.push(c);
      }
      const from = was.get(v.id);
      const p = c.size;
      c.reserve(p + 1);
      const at = from?.rowOf.get(v.id);
      if (from !== undefined && at !== undefined) this.copyRow(from, at, c, p);
      else this.newRow(c, p, v);
      if (c.hot[p * c.stride + H_EPOCH] === 0 && v.state !== 'pending')
        c.hot[p * c.stride + H_EPOCH] = ++this.epochs;
      c.rowOf.set(v.id, p);
      next.set(v.id, c);
      v.laned = true;
    }
    this.crowds = crowds;
    if (crowds.length === 0) this.lawsByKey.clear();
    was.clear();
    for (const [id, c] of next) was.set(id, c);
  }

  private copyRow(from: Crowd<I, O>, p: number, to: Crowd<I, O>, q: number): void {
    to.list[q] = from.list[p] as number;
    to.data.set(from.data.subarray(p * STRIDE, (p + 1) * STRIDE), q * STRIDE);
    to.hot.set(from.hot.subarray(p * from.stride, (p + 1) * from.stride), q * to.stride);
    to.samples.set(from.samples.subarray(p * from.axes, (p + 1) * from.axes), q * to.axes);
    to.deltas[q] = from.deltas[p] ?? null;
    to.records[q] = from.records[p];
    to.voices[q] = from.voices[p] as Voice<I, O>;
    to.motions[q] = from.motions[p];
    to.eases[q] = from.eases[p];
    to.laws[q] = from.laws[p] as Float64Array;
    to.flats[q] = from.flats[p] ?? null;
    to.touches[q] = from.touches[p] as (s: number) => void;
    const odd = from.odd?.get(p);
    if (odd !== undefined) {
      to.odd ??= new Map();
      to.odd.set(q, odd);
    }
  }

  private newRow(c: Crowd<I, O>, p: number, v: Voice<I, O>): void {
    const run = motionOf<I>(v.patch);
    const h = p * c.stride;
    c.hot.fill(0, h, h + c.stride);
    c.hot[h + H_FLAGS] = F_VOICE | F_STALE | (run === undefined ? 0 : F_MOTION);
    c.hot[h + H_ID] = v.id;
    c.list[p] = -1;
    const o = p * STRIDE;
    c.data.fill(0, o, o + STRIDE);
    c.data[o + MSLOT] = -1;
    c.data[o + SAMPLED] = -1;
    c.deltas[p] = null;
    c.records[p] = undefined;
    c.voices[p] = v;
    c.motions[p] = run;
    const ch = c.chans[0] as Laned;
    c.flats[p] = v.built === null ? null : flatOf(v.built, ch.scalar, ch.axes, ch.rest);
    if (run === undefined) {
      c.laws[p] = none;
      c.eases[p] = undefined;
      c.touches[p] = noTouch;
      return;
    }
    c.laws[p] = this.lawOf(run);
    c.eases[p] = run.ease;
    const id = v.id;
    const touch = () => this.touchedCrowd(id);
    run.touched = touch;
    c.touches[p] = touch;
  }

  /** A patch's law, as the one array every crowd row with the same law shares. */
  private lawOf(run: Motions<I>): Float64Array {
    const law = run.law();
    const key = law.join(' ');
    const known = this.lawsByKey.get(key);
    if (known !== undefined) return known;
    this.lawsByKey.set(key, law);
    return law;
  }

  /** A crowd voice's patch changed a stretch: its copy is read again at the next fill. */
  private touchedCrowd(id: number): void {
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c === undefined || p === undefined) return;
    const f = p * c.stride + H_FLAGS;
    c.hot[f] = (c.hot[f] as number) | F_STALE;
  }

  /** Something on a voice changed: a crowd copies it again at the next fill. */
  voiceChanged(id: number): void {
    const c = this.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c === undefined || p === undefined) return;
    const f = p * c.stride + H_FLAGS;
    c.hot[f] = (c.hot[f] as number) | F_VOICE;
  }

  /** Hands a crowd voice back to the general path, as `leave` does a lane's. */
  private leaveCrowd(c: Crowd<I, O>, p: number): void {
    const slot = c.list[p] as number;
    const rec = c.records[p];
    if (slot >= 0) {
      if (c.idle) this.reach(slot, -1);
      const w = this.reportedRow(c, p, slot);
      if (rec !== undefined && w !== undefined) rec.weight = w;
      if (rec !== undefined && c.motions[p] !== undefined) this.settle(c, p, slot, rec);
    }
    const run = c.motions[p];
    if (run !== undefined && run.touched === c.touches[p]) run.touched = noTouch;
    (c.voices[p] as Voice<I, O>).laned = false;
  }

  /** A crowd row's weight as `reported` reads a lane position's. */
  private reportedRow(c: Crowd<I, O>, p: number, slot: number): number | undefined {
    const o = slot * SLOT;
    if (!((this.per[o + LANE_PROBE] as number) > (this.per[o + GENERAL_PROBE] as number)))
      return undefined;
    if ((c.list[p] as number) !== slot) return undefined;
    return c.data[p * STRIDE + (this.per[o + LANE_FILL] === this.fills ? WEIGHT : PROBED)];
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
    this.flush();
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
      // Deciding which lanes and crowds go idle first, then running them, in voice order: a crowd's
      // rows are folded between the lanes on either side of their voices, as the general path
      // folds every voice in order.
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
        if (!lane.idle) busy = true;
      }
      for (const c of this.crowds) {
        if (decide) {
          if (c.size >= 64) this.pace(c);
          else if (c.idle ? share >= c.line.start : share < c.line.stop) this.flip(c);
        }
        c.cursor = 0;
        if (!c.idle && c.size > 0) busy = true;
      }
      if (busy) {
        for (const ch of this.laned) ch.values.fill(ch.rest, 0, size * ch.axes);
        for (const lane of this.runs) {
          if (lane.idle) continue;
          if (this.crowds.length > 0) this.crowdsUpTo(lane.voice.id);
          this.run(lane);
        }
        if (this.crowds.length > 0) this.crowdsUpTo(Number.POSITIVE_INFINITY);
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
  private pace(lane: Paced): void {
    const list = lane.list;
    const line = lane.line;
    const from = this.lastFrom;
    const to = this.lastTo;
    const step = primeFrom(Math.floor(list.length / 256));
    let looked = 0;
    let probed = 0;
    for (let p = this.fills % step; p < list.length; p += step) {
      const slot = list[p] as number;
      if (slot < 0) continue;
      const a = this.per[slot * SLOT + LANE_PROBE] as number;
      const b = this.per[slot * SLOT + GENERAL_PROBE] as number;
      if ((a > from && a <= to) || (b > from && b <= to)) probed++;
      looked++;
    }
    const share = looked > 0 ? probed / looked : 1;
    if (lane.idle ? share >= line.start : share < line.stop) this.flip(lane);
  }

  private flip(lane: Paced): void {
    if (lane.idle) this.wake(lane);
    else this.rest(lane);
  }

  /** Leaves a lane's subjects to the general path until it wakes, keeping what `weightOf` reports. */
  private rest(lane: Paced): void {
    lane.idle = true;
    const list = lane.list;
    const data = lane.data;
    for (let p = 0; p < list.length; p++) {
      const slot = list[p] as number;
      if (slot < 0) continue;
      this.reach(slot, 1);
      // A probe read this subject from the last fill, which this lane's weight stays from.
      if (this.per[slot * SLOT + LANE_FILL] === this.fills - 1) {
        const o = p * STRIDE;
        data[o + PROBED] = data[o + WEIGHT] as number;
      }
    }
  }

  private wake(lane: Paced): void {
    lane.idle = false;
    for (const slot of lane.list) if (slot >= 0) this.reach(slot, -1);
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
    if (voice.state === 'pending' || voice.state === 'done') return;
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
    const elapsed = held(voice, elapsedNow - delay);
    if (!(elapsed >= 0)) {
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
        this.readKeyed(voice, lane.phase, lane.delta, lane.scratch);
        lane.read = true;
        lane.readAt = elapsed;
        this.gather(lane, lane.delta);
      }
      if (w > 0) this.fold(lane, slot, w);
      return;
    }
    const rec = lane.records[p] as Subject<unknown>;
    // The general path makes a voice's first call for a subject, where it first sees it play.
    if (Number.isNaN(rec.probed)) {
      this.late.push(slot);
      return;
    }
    // A motion patch needs the subject only to number it, so the lookup waits until then.
    if (lane.motion !== undefined) {
      this.move(lane, lane.motion, p, slot, rec, elapsed, delay, w);
      return;
    }
    this.call(voice, lane.chans, rec, slot, elapsed, lane.phase, lane.pass, delay, w);
  }

  /** Reads a keys voice's stops at `phase` into `delta`, interpolating into the reader's `scratch`. */
  private readKeyed(
    voice: Voice<I, O>,
    phase: number,
    delta: Record<string, unknown>,
    scratch: Scratch,
  ): void {
    readKeys(
      voice.built as NonNullable<Voice<I, O>['built']>,
      phase,
      delta,
      undefined,
      voice.lerps as never,
      undefined,
      voice.intos,
      scratch,
    );
  }

  /** Calls a stateless fn voice's patch for a subject its general path has met, and folds the delta. */
  private call(
    voice: Voice<I, O>,
    chans: readonly Laned[],
    rec: Subject<unknown>,
    slot: number,
    elapsed: number,
    phase: number,
    pass: number,
    delay: number,
    w: number,
  ): void {
    const host = this.host;
    const subject = this.subjectAt(slot);
    if (subject === absent) return;
    // Called already this frame, by the general path or a fill before a refill: reuse, as a probe does.
    if (rec.probed === this.now && rec.delta !== null && rec.seeks === voice.seeks) {
      if (w > 0) this.foldDelta(chans, slot, rec.delta, w);
      return;
    }
    const kept = reading.kept;
    host.ready(voice, subject, rec, elapsed, pass, w);
    host.horizon(voice, delay);
    const delta = voice.patch.at(phase, subject, voice.setting as never) as Record<string, unknown>;
    // What `influence` leaves on the record, so a probe on the general path this frame reuses it.
    rec.delta = delta;
    rec.probed = this.now;
    rec.seeks = voice.seeks;
    if (this.keeps) host.after(voice, rec);
    if (reading.kept !== kept && !voice.keeping) host.kept(voice);
    if (w > 0) this.foldDelta(chans, slot, delta, w);
  }

  /** Runs every crowd's rows whose voices come before voice `id`, from where each crowd reached. */
  private crowdsUpTo(id: number): void {
    for (const c of this.crowds) if (!c.idle && c.cursor < c.size) this.runCrowd(c, id);
  }

  /**
   * A crowd's rows from its cursor up to voice `id`: what `runMotion` does for a lane's subjects,
   * reading each row's voice and stretch from `hot`, and through `move` for whatever `hot` cannot
   * answer, as `runMotion` does.
   */
  private runCrowd(c: Crowd<I, O>, id: number): void {
    const data = c.data;
    const hot = c.hot;
    const H = c.stride;
    const per = this.per;
    const list = c.list;
    const ch = c.chans[0] as Laned;
    const n = c.axes;
    const fills = this.fills;
    const from = this.frameProbes;
    const probed = this.probes !== from;
    const now = this.now;
    const xs = c.xs;
    const vs = c.vs;
    const samples = c.samples;
    let p = c.cursor;
    for (; p < list.length; p++) {
      const h = p * H;
      if ((hot[h + H_ID] as number) >= id) break;
      let f = hot[h + H_FLAGS] as number;
      if ((f & F_VOICE) !== 0) f = this.copyVoice(c, p);
      if ((f & F_PLAYING) === 0 || (f & F_PLACED) === 0) continue;
      const slot = list[p] as number;
      const o = p * STRIDE;
      const q = slot * SLOT;
      if (per[q + LANE_FILL] === fills - 1) data[o + PROBED] = data[o + WEIGHT] as number;
      const delay = data[o + DELAY] as number;
      const fast = (f & F_FAST) !== 0;
      const voice = c.voices[p] as Voice<I, O>;
      const elapsedNow = fast
        ? (hot[h + H_ELAPSED] as number) +
          (now - (hot[h + H_NOW] as number)) * (hot[h + H_RATE] as number)
        : voice.elapsedAt(now);
      let elapsed = elapsedNow - delay;
      if ((f & F_HOLDS) !== 0) elapsed = held(voice, elapsed);
      if (!(elapsed >= 0)) {
        data[o + WEIGHT] = 0;
        continue;
      }
      let w: number;
      if (fast) w = hot[h + H_WEIGHT] as number;
      else {
        w = clampWeight(voice.weight * this.host.envelope(voice, data[o + SINCE] as number));
        if (voice.parts !== null) {
          const subject = this.subjectAt(slot);
          if (subject !== absent) w *= this.host.parting(voice, subject);
        }
      }
      data[o + WEIGHT] = w;
      if ((f & F_MOTION) === 0) {
        this.row(c, p, voice, slot, elapsed, delay, w);
        continue;
      }
      if (data[o + MET] === 0) {
        if (Number.isNaN((c.records[p] as Subject<unknown>).probed)) {
          this.late.push(slot);
          continue;
        }
        data[o + MET] = 1;
      }
      const ms = data[o + MSLOT] as number;
      if ((f & F_STALE) !== 0 && ms >= 0) f = this.copyStretch(c, p, ms);
      if (
        ms < 0 ||
        (f & F_BARE) === 0 ||
        (probed &&
          ((per[q + LANE_PROBE] as number) > from || (per[q + GENERAL_PROBE] as number) > from))
      ) {
        const run = c.motions[p] as Motions<I>;
        this.move(c, run, p, slot, c.records[p] as Subject<unknown>, elapsed, delay, w);
        // The first sample numbered the subject in the patch: copy its stretch from the next fill.
        if (ms < 0) hot[h + H_FLAGS] = (hot[h + H_FLAGS] as number) | F_STALE;
        continue;
      }
      closed(
        c.laws[p] as Float64Array,
        c.eases[p],
        n,
        hot[h + H_AT] as number,
        hot[h + H_MS] as number,
        hot,
        h + H_X0,
        hot,
        h + H_X0 + n,
        hot,
        h + H_X0 + 2 * n,
        elapsed,
        xs,
        vs,
      );
      for (let a = 0; a < n; a++) samples[p * n + a] = xs[a] as number;
      if (c.deltas[p] !== null) c.deltas[p] = null;
      data[o + SAMPLED] = fills;
      data[o + SEEKS] = hot[h + H_SEEKS] as number;
      if (w <= 0) continue;
      if ((f & F_FOLDS) !== 0) this.foldRun(ch, slot, xs, w);
      else this.foldInto(ch, slot, (c.motions[p] as Motions<I>).value(ms, xs), w);
    }
    c.cursor = p;
  }

  /** A keys or fn row's contribution, as `one` makes a lane position's. */
  private row(
    c: Crowd<I, O>,
    p: number,
    voice: Voice<I, O>,
    slot: number,
    elapsed: number,
    delay: number,
    w: number,
  ): void {
    const period = voice.patch.period;
    const phase = phaseAt(elapsed, period, voice.passes);
    if (voice.built !== null) {
      if (!(w > 0)) return;
      const flat = c.flats[p] as Flat | null;
      if (flat !== null) {
        readFlat(flat, phase, period, c.xs);
        this.foldRun(c.chans[0] as Laned, slot, c.xs, w);
        return;
      }
      this.readKeyed(voice, phase, c.delta, c.scratch);
      this.foldDelta(c.chans, slot, c.delta, w);
      return;
    }
    const rec = c.records[p] as Subject<unknown>;
    if (Number.isNaN(rec.probed)) {
      this.late.push(slot);
      return;
    }
    this.call(
      voice,
      c.chans,
      rec,
      slot,
      elapsed,
      phase,
      passAt(elapsed, period, voice.passes),
      delay,
      w,
    );
  }

  /** Copies what a fill reads of a crowd row's voice into `hot`; returns the row's flags. */
  private copyVoice(c: Crowd<I, O>, p: number): number {
    const v = c.voices[p] as Voice<I, O>;
    const h = p * c.stride;
    let f = (c.hot[h + H_FLAGS] as number) & ~(F_VOICE | F_PLAYING | F_FAST | F_HOLDS);
    if (v.state === 'live' || v.state === 'held' || v.state === 'fading') f |= F_PLAYING;
    if (v.holdsBefore || v.holdsAfter) f |= F_HOLDS;
    if (
      v.ramp === null &&
      !((v.fade.in ?? 0) > 0) &&
      v.out === null &&
      v.parts === null &&
      !v.keeping
    )
      f |= F_FAST;
    c.hot[h + H_NOW] = v.anchorNow;
    c.hot[h + H_ELAPSED] = v.anchorElapsed;
    c.hot[h + H_RATE] = v.rate;
    c.hot[h + H_WEIGHT] = clampWeight(v.weight);
    c.hot[h + H_SEEKS] = v.seeks;
    c.hot[h + H_FLAGS] = f;
    return f;
  }

  /** Copies a crowd row's current stretch from its patch into `hot`; returns the row's flags. */
  private copyStretch(c: Crowd<I, O>, p: number, ms: number): number {
    const run = c.motions[p] as Motions<I>;
    const h = p * c.stride;
    let f = (c.hot[h + H_FLAGS] as number) & ~(F_STALE | F_BARE | F_FOLDS);
    const ch = c.chans[0] as Laned;
    if (run.n === c.axes && run.stretchInto(ms, c.hot, h + H_AT)) {
      f |= F_BARE;
      if (run.scalar(ms) === ch.scalar) f |= F_FOLDS;
    }
    c.hot[h + H_FLAGS] = f;
    return f;
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
    // On a frame's first fill no probe has read a subject yet, so none needs `move` for that.
    const probed = this.probes !== from;
    const whole = clampWeight(voice.weight);
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
      let w = flat ? whole : clampWeight(voice.weight * lane.fade);
      if (parts) {
        const subject = this.subjectAt(slot);
        if (subject !== absent) w *= this.host.parting(voice, subject);
      }
      data[o + WEIGHT] = w;
      if (data[o + MET] === 0) {
        if (Number.isNaN((records[p] as Subject<unknown>).probed)) {
          this.late.push(slot);
          continue;
        }
        data[o + MET] = 1;
      }
      const ms = data[o + MSLOT] as number;
      if (
        ms < 0 ||
        (probed &&
          ((per[q + LANE_PROBE] as number) > from || (per[q + GENERAL_PROBE] as number) > from)) ||
        !run.sampleBare(ms, elapsed, xs, run.vs)
      ) {
        this.move(lane, run, p, slot, records[p] as Subject<unknown>, elapsed, delay, w);
        continue;
      }
      for (let a = 0; a < n; a++) samples[p * n + a] = xs[a] as number;
      if (lane.deltas[p] !== null) lane.deltas[p] = null;
      data[o + SAMPLED] = fills;
      data[o + SEEKS] = seeks;
      if (w <= 0) continue;
      if (n === ch.axes && run.scalar(ms) === ch.scalar) this.foldRun(ch, slot, xs, w);
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
    lane: Positions<I, O>,
    run: Motions<I>,
    p: number,
    slot: number,
    held: Subject<unknown>,
    elapsed: number,
    delay: number,
    w: number,
  ): void {
    const voice = lane.voiceAt(p);
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
      lane.keep(p, run.xs, n);
      lane.deltas[p] = null;
      data[o + SAMPLED] = this.fills;
      data[o + SEEKS] = voice.seeks;
      if (w <= 0) return;
      // A sample of other axes than the channel's folds as the general path folds it.
      if (n === ch.axes && run.scalar(ms) === ch.scalar) this.foldRun(ch, slot, run.xs, w);
      else this.foldInto(ch, slot, run.value(ms, run.xs), w);
      return;
    }
    lane.deltas[p] = delta;
    data[o + SAMPLED] = this.fills;
    data[o + SEEKS] = voice.seeks;
    if (w > 0) this.foldInto(ch, slot, delta[ch.name], w);
  }

  /** The delta a motion voice's last sample for position `p` made, built from `samples`. */
  private sampled(lane: Positions<I, O>, p: number): Record<string, unknown> {
    const run = lane.motionAt(p) as Motions<I>;
    lane.kept(p, run.xs);
    const ms = lane.data[p * STRIDE + MSLOT] as number;
    const delta = { [(lane.chans[0] as Laned).name]: run.value(ms, run.xs) };
    lane.deltas[p] = delta;
    return delta;
  }

  /**
   * A probe this frame read a motion voice's value for the subject from an earlier fill: write onto
   * its record what the general path's sample would have, so a later read this frame reuses it.
   */
  private settle(lane: Positions<I, O>, p: number, slot: number, held: Subject<unknown>): void {
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
    chans: readonly Laned[],
    slot: number,
    delta: Record<string, unknown>,
    w: number,
  ): void {
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
    if (ch.scalar) {
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
