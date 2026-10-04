import { foldNumber, lerpNumber, type Numeric, numericOf } from './channels.js';
import { clampWeight, heldTime, passAt, phaseAt, weighed } from './clock.js';
import type { Curve } from './easing.js';
import type { Subject, Voice } from './mixer.js';
import { closed, type Motions, motionOf, noTouch } from './motion.js';
import { absent, Numbers } from './numbers.js';
import { AT, NOTHING, readKeys, type Scratch, seg, segment, shifted, type Track } from './patch.js';
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
   * stateful if the signal keeps state.
   */
  signal(
    voice: Voice<I, O>,
    subject: I,
    held: Subject<unknown>,
    elapsed: number,
    pass: number,
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
  /** Its place among the laned channels. */
  index: number;
}

/**
 * The laned voices sharing one locus, in voice order, and what a fill gathers from them for each
 * subject before folding it in at the subject's first member: their summed weight, and per laned
 * channel the members' values lerped by share of weight and the weight taken into each.
 */
interface Locus<I, O> {
  readonly members: Lane<I, O>[];
  /** By subject number: the fill that last met it, the member it met first then, the summed weight. */
  met: Float64Array;
  first: Float64Array;
  sum: Float64Array;
  /** By laned channel, then subject number (times axes for `values`). */
  values: (Float64Array | undefined)[];
  taken: (Float64Array | undefined)[];
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

/** What `begin` found: the general path, or lanes filled. */
const GENERAL = 0;
const READY = 1;

const SLOT = 6;
const FILLED = 0;
/**
 * The latest epoch a probe has checked the subject against; or, as `-1 - e`, that a voice naming
 * it started after epoch `e`, so its next probe checks it against everything since `e`.
 */
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
  /** The locus its voice shares, gathered before the voices are folded in order. */
  group: Locus<I, O> | null = null;

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

/**
 * Whether a laned voice belongs in a crowd: one naming a single subject, which shares nothing
 * across subjects for a lane to save. A motion voice writes one channel; a keys or fn voice may
 * write several, and joins the crowd of voices writing those same channels.
 */
function crowdable<I, O>(v: Voice<I, O>): boolean {
  return (
    v.named !== null &&
    v.named.size === 1 &&
    v.spec.locus === undefined &&
    (v.slots.length === 1 || v.motion === undefined)
  );
}

/** `xs`, or a copy at least `n` long where it is shorter. */
function sized(xs: Float64Array, n: number): Float64Array {
  if (xs.length >= n) return xs;
  const grown = new Float64Array(n);
  grown.set(xs);
  return grown;
}

/** Whether two crowds' channels are the same list. */
function same(a: readonly Laned[], b: readonly Laned[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A subject's voice time once its voice's holds apply: held at 0 before it starts and at the end of
 * its passes after, and NaN where it shows nothing.
 */
function held<I, O>(voice: Voice<I, O>, elapsed: number): number {
  return heldTime(elapsed, voice.holdsBefore, voice.holdsAfter, voice.span);
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
  touches: ((s: number) => void)[] = [];
  readonly rowOf = new Map<number, number>();
  idle = false;
  readonly line = SPARSE.other;
  /** Where the fill now under way has reached. */
  cursor = 0;
  /** Rows whose voices have left, kept in place until the crowds are next rebuilt. */
  dead = 0;
  /** Whether some row is `F_STALE`, for `freshen` to copy before the fill's loop. */
  stale = false;
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

  /** Marks row `p` to copy its stretch from its patch again before the next fill reads it. */
  restale(p: number, flags: number): void {
    this.hot[p * this.stride + H_FLAGS] = flags | F_STALE;
    this.stale = true;
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
  /** The lanes over every subject that have started playing, by epoch. */
  private dense: Lane<I, O>[] = [];
  private readonly byId = new Map<number, Lane<I, O>>();
  /** The crowds of single-subject motion voices, one per channel, and which holds each voice. */
  private crowds: Crowd<I, O>[] = [];
  private readonly crowdOf = new Map<number, Crowd<I, O>>();
  /** Whether two crowds share a channel, so their rows must interleave in voice order. */
  private overlap = false;
  /** The loci whose voices are on lanes, every member of each on one. */
  private loci: Locus<I, O>[] = [];
  /** While a fill gathers a locus: that locus and the member gathering, where folds go instead. */
  private into: Locus<I, O> | null = null;
  private intoId = 0;
  private readonly lawsByKey = new Map<string, Float64Array>();
  private lastLaw: Float64Array | null = null;
  /** The lanes the last `meet` gave a position, and whether it placed a crowd row. */
  private readonly met: number[] = [];
  private metCrowd = false;
  /** By subject number, the laned voices its probes fold on the general path this fill. */
  private readonly owed = new Map<number, number[]>();
  private laned: Laned[] = [];
  /** By kit slot, the laned channel there. */
  private bySlot: (Laned | undefined)[] = [];
  /** By kit slot, whether a fill leaves the channel's values for probes to copy. */
  readonly copies: boolean[] = [];
  /** Whether every voice in the mix is on a lane, so a filled subject has nothing left to fold. */
  whole = false;
  private cap = 0;
  private epochs = 0;
  /** The latest epoch of a lane over every subject, which every subject meets on its next probe. */
  private wide = 0;
  /** Voices that joined, started or left since the last qualify, settled at the next probe. */
  private touched: Voice<I, O>[] = [];
  /** The highest voice id the last qualify or settling of `touched` considered. */
  private known = 0;
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
    this.per[slot * SLOT + FILLED] = 0;
    this.per[slot * SLOT + SEEN] = -1;
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
    if (slot < this.cap) this.per[slot * SLOT + SEEN] = -1;
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
    const ready = this.filled(now, version) ? READY : this.begin(now, version);
    if (ready === GENERAL) return this.general(slot);
    if (slot < 0) return false;
    if (!this.probedThisFrame(slot)) this.distinct++;
    const probe = ++this.probes;
    const per = this.per;
    const o = slot * SLOT;
    let lane = per[o + FILLED] === this.fills && per[o + IDLE] === 0;
    if ((per[o + SEEN] as number) < this.wide && this.meet(slot, subject)) {
      // The fill ran before the subject had these positions. Where every voice it just met folds
      // after every other laned voice, the general path folds just those onto the lanes' values;
      // otherwise it reads the general path all frame.
      if (lane && per[o + IDLE] === 0 && this.owable(slot)) this.owed.set(slot, this.met.slice());
      else {
        per[o + FILLED] = 0;
        lane = false;
      }
    }
    if (lane) {
      per[o + LANE_PROBE] = probe;
      per[o + LANE_FILL] = this.fills;
      this.subjects[slot] = subject;
      this.holding = true;
    } else per[o + GENERAL_PROBE] = probe;
    return lane;
  }

  /**
   * For a `pull` of a list it read last time in the same order, with every voice on a lane, where
   * `heads` holds each position's remembered chain head unless all are known current: what
   * `prepare` and `writeLater` do for each subject from position `from`, while the subject reads
   * from the lanes; returns the first position that does not, or the list's length.
   */
  pullRun(
    slots: Int32Array,
    list: readonly I[],
    was: readonly I[],
    heads: readonly ({ version: number } | undefined)[] | null,
    from: number,
    columns: readonly Column[],
    now: number,
    version: number,
  ): number {
    const ready = this.filled(now, version) ? READY : this.begin(now, version);
    if (ready !== READY || !this.whole) return from;
    const per = this.per;
    const fills = this.fills;
    const wide = this.wide;
    const frame = this.frameProbes;
    const subjects = this.subjects;
    let n = from;
    for (; n < list.length; n++) {
      const subject = list[n] as I;
      if (was[n] !== subject || (heads !== null && heads[n]?.version !== version)) break;
      const slot = slots[n] as number;
      const o = slot * SLOT;
      if (
        slot < 0 ||
        per[o + FILLED] !== fills ||
        per[o + IDLE] !== 0 ||
        (per[o + SEEN] as number) < wide ||
        (this.owed.size > 0 && this.owed.has(slot))
      )
        break;
      if (!((per[o + LANE_PROBE] as number) > frame || (per[o + GENERAL_PROBE] as number) > frame))
        this.distinct++;
      per[o + LANE_PROBE] = ++this.probes;
      per[o + LANE_FILL] = fills;
      subjects[slot] = subject;
      this.writeLater(slot, columns, n);
    }
    if (n > from) this.holding = true;
    return n;
  }

  /** Whether this frame's lanes are filled and nothing since asks `begin` to look again. */
  private filled(now: number, version: number): boolean {
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
  private begin(now: number, version: number): number {
    if (now !== this.frameAt) {
      this.lastFrom = this.frameProbes;
      this.lastTo = this.probes;
      this.lastDistinct = this.distinct;
      this.distinct = 0;
      this.frameAt = now;
      this.frameProbes = this.probes;
      this.fresh = true;
    }
    if (this.filling) return GENERAL;
    // The mix's version moves only when a voice over every subject comes, goes, starts or stops
    // waiting, each of which touches it, so a version past a qualify that stands is a set of touches.
    if (this.qualifiedVersion !== version) {
      if (!Number.isNaN(this.qualifiedVersion) && this.touched.length > 0 && this.retouch())
        this.qualifiedVersion = version;
      else this.requalify(version);
    } else if (this.touched.length > 0 && !this.retouch()) this.requalify(version);
    if (this.laned.length === 0) return GENERAL;
    if (this.filledAt !== now || this.filledVersion !== version || this.moved !== reading.moved) {
      this.fillAll(now, version);
      // A patch call in that fill made kept state, which took its voice off its lane: fill without it.
      if (this.qualifiedVersion !== version) {
        this.requalify(version);
        if (this.laned.length === 0) return GENERAL;
        this.fillAll(now, version);
      }
    }
    return READY;
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

  /**
   * Whether the lanes a probe of the subject at `slot` just met (`met`) can be folded on the general
   * path after the lanes' values: none is in a locus or a crowd, the subject owes none already this
   * fill, and each comes after every other laned voice in voice order, so folding it last folds in
   * the general path's order.
   */
  private owable(slot: number): boolean {
    if (this.metCrowd || this.owed.has(slot)) return false;
    const met = this.met;
    let other = Number.NEGATIVE_INFINITY;
    for (const lane of this.lanes) {
      const id = lane.voice.id;
      if (id > other && !met.includes(id)) other = id;
    }
    for (const c of this.crowds)
      if (c.size > 0) other = Math.max(other, c.hot[(c.size - 1) * c.stride + H_ID] as number);
    for (const id of met)
      if (id <= other || (this.byId.get(id) as Lane<I, O>).group !== null) return false;
    return true;
  }

  /** Whether the subject at `slot` reads some laned voice from the general path this fill. */
  owes(slot: number): boolean {
    return this.owed.size > 0 && this.owed.has(slot);
  }

  /** Whether the subject at `slot` reads laned voice `id` from the general path this fill. */
  owesVoice(slot: number, id: number): boolean {
    return (this.owed.get(slot) as number[]).includes(id);
  }

  /** The weight the general path gave a voice the subject at `slot` owes, as `weightOf` reports. */
  paid(id: number, slot: number, w: number): void {
    const lane = this.byId.get(id);
    const p = lane === undefined ? -1 : lane.positionOf(slot);
    if (p >= 0) (lane as Lane<I, O>).data[p * STRIDE + WEIGHT] = w;
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

  /**
   * Gives a probed subject a position on every lane that started playing since the subject was last
   * checked and that reaches it. True when any did, so the probe takes the general path.
   */
  private meet(slot: number, subject: I): boolean {
    const seen = this.per[slot * SLOT + SEEN] as number;
    const from = seen < 0 ? -1 - seen : seen;
    this.per[slot * SLOT + SEEN] = this.epochs;
    let met = false;
    this.met.length = 0;
    this.metCrowd = false;
    const dense = this.dense;
    for (let i = dense.length - 1; i >= 0; i--) {
      const lane = dense[i] as Lane<I, O>;
      if (lane.epoch <= from) break;
      if (lane.positionOf(slot) >= 0) continue;
      const held = this.host.meet(lane.voice, subject);
      if (!held.reaches) continue;
      lane.add(slot, held);
      if (lane.idle) this.reach(slot, 1);
      this.met.push(lane.voice.id);
      met = true;
    }
    const naming = this.host.naming(subject);
    if (naming !== undefined)
      for (const voice of naming) {
        const lane = this.byId.get(voice.id);
        if (lane === undefined) {
          if (this.place(voice, slot, subject, from)) {
            met = true;
            this.metCrowd = true;
          }
          continue;
        }
        if (lane.epoch <= from || lane.positionOf(slot) >= 0) continue;
        const held = this.host.meet(voice, subject);
        if (!held.reaches) continue;
        lane.add(slot, held);
        if (lane.idle) this.reach(slot, 1);
        this.met.push(voice.id);
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
    c.restale(p, flags | F_PLACED);
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
    const touched = this.touched.slice();
    this.touched.length = 0;
    const present = host.voices.filter((v) => v.state !== 'done');
    for (const v of present) if (v.id > this.known) this.known = v.id;
    const numeric = host.channels.map((c) => numericOf(c) !== undefined);
    // A voice writing nothing has no lane to fill, so it stays where its calls are made.
    const fits = present.map((v) => v.slots.length > 0 && host.fits(v));
    const candidates = () =>
      present.map((v, i) => ({ id: v.id, fits: fits[i] as boolean, slots: v.slots }));
    let { channels, voices } = qualify(numeric, candidates());
    // A locus folds its members together, so they run on lanes all together or not at all.
    for (let split = true; split; ) {
      split = false;
      const loci = new Map<string, number[]>();
      present.forEach((v, i) => {
        const name = v.spec.locus;
        if (name === undefined) return;
        const at = loci.get(name);
        if (at === undefined) loci.set(name, [i]);
        else at.push(i);
      });
      for (const at of loci.values()) {
        const on = at.filter((i) => voices.has((present[i] as Voice<I, O>).id)).length;
        if (on === 0 || on === at.length) continue;
        for (const i of at) fits[i] = false;
        split = true;
      }
      if (split) ({ channels, voices } = qualify(numeric, candidates()));
    }
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
      if (lane.epoch === 0 && v.state !== 'pending') lane.epoch = this.open(v);
      kept.push(lane);
    }
    this.lanes = kept;
    this.loci = [];
    const loci = new Map<string, Locus<I, O>>();
    for (const lane of kept) {
      lane.group = null;
      const name = lane.voice.spec.locus;
      if (name === undefined) continue;
      let g = loci.get(name);
      if (g === undefined) {
        g = {
          members: [],
          met: new Float64Array(this.cap),
          first: new Float64Array(this.cap),
          sum: new Float64Array(this.cap),
          values: [],
          taken: [],
        };
        loci.set(name, g);
        this.loci.push(g);
      }
      g.members.push(lane);
      lane.group = g;
    }
    this.dense = kept
      .filter((l) => l.voice.named === null && l.epoch > 0)
      .sort((a, b) => a.epoch - b.epoch);
    this.whole = kept.length + crowded === present.length;
    this.byId.clear();
    for (const lane of kept) this.byId.set(lane.voice.id, lane);
    // With no lane left no fill comes to let go of the subjects the last probes held.
    if (kept.length === 0 && crowded === 0) this.subjects = [];
    const members = present.filter((v) => voices.has(v.id) && crowdable(v));
    // The same channels laned and the same voices crowded, as when a voice over every subject comes
    // or goes among a crowd of thousands: what a rebuild would make is what is there.
    if (this.sameChannels(channels) && this.sameCrowds(members)) {
      for (const lane of kept) {
        lane.chans = lane.voice.slots.map((s) => this.bySlot[s] as Laned);
        lane.values = lane.chans.map(() => undefined);
      }
      for (const c of this.crowds)
        for (let p = 0; p < c.size; p++) {
          const v = c.voices[p] as Voice<I, O>;
          if (c.rowOf.get(v.id) === p && v.state === 'done') this.bury(c, p);
        }
      // A crowd voice that started or began fading takes it up on its row, as `retouch` does.
      for (const v of touched) {
        if (v.state === 'done') continue;
        const c = this.crowdOf.get(v.id);
        const p = c?.rowOf.get(v.id);
        if (c !== undefined && p !== undefined) this.retouchRow(c, p, v);
      }
      this.compactSparse();
      return;
    }
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
        index: this.laned.length,
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
    this.regroup(members);
  }

  /** Whether qualifying laned exactly the channels laned now. */
  private sameChannels(channels: readonly boolean[]): boolean {
    const by = this.bySlot;
    if (by.length !== channels.length) return false;
    for (let i = 0; i < by.length; i++) if ((by[i] !== undefined) !== channels[i]) return false;
    return true;
  }

  /**
   * Whether every voice qualifying for a crowd has its row, and every row's voice either qualified
   * or is done, so the crowds stand as a rebuild would leave them, departed rows aside.
   */
  private sameCrowds(members: readonly Voice<I, O>[]): boolean {
    let live = 0;
    for (const v of members) {
      if (!this.crowdOf.has(v.id)) return false;
      live++;
    }
    let rows = 0;
    for (const [id, c] of this.crowdOf) {
      const p = c.rowOf.get(id) as number;
      if ((c.voices[p] as Voice<I, O>).state !== 'done') rows++;
    }
    return rows === live;
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
    const old = this.crowds;
    const was = new Map(this.crowdOf);
    this.crowds = [];
    this.crowdOf.clear();
    this.overlap = false;
    for (const v of members) {
      const from = was.get(v.id);
      this.join(v, from, from?.rowOf.get(v.id), old);
    }
    if (this.crowds.length === 0) {
      this.lawsByKey.clear();
      this.lastLaw = null;
    }
  }

  /**
   * Gives a voice the next row of its channel's crowd, made if there is none: a copy of the row it
   * had in `from` at `at`, or a new one. `old` holds the crowds being replaced, whose idle state a
   * new crowd on the same channel keeps. Rows stay in voice order only because voices join in it.
   */
  private join(
    v: Voice<I, O>,
    from: Crowd<I, O> | undefined,
    at: number | undefined,
    old: readonly Crowd<I, O>[],
  ): void {
    const chans = v.slots.map((s) => this.bySlot[s] as Laned);
    let c = this.crowds.find((o) => same(o.chans, chans));
    if (c === undefined) {
      c = new Crowd<I, O>(chans, (chans[0] as Laned).axes);
      const names = chans.map((ch) => ch.name).join(' ');
      const was = old.find((o) => o.chans.map((ch) => ch.name).join(' ') === names);
      if (was !== undefined) c.idle = was.idle;
      for (const o of this.crowds)
        if (o.chans.some((ch) => chans.includes(ch))) this.overlap = true;
      this.crowds.push(c);
    }
    const p = c.size;
    c.reserve(p + 1);
    if (from !== undefined && at !== undefined) this.copyRow(from, at, c, p);
    else this.newRow(c, p, v);
    if (c.hot[p * c.stride + H_EPOCH] === 0 && v.state !== 'pending')
      c.hot[p * c.stride + H_EPOCH] = this.open(v);
    c.rowOf.set(v.id, p);
    this.crowdOf.set(v.id, c);
    v.laned = true;
  }

  /**
   * A voice starts playing on a lane or crowd: its epoch. Every subject meets a voice over all of
   * them on its next probe; a voice naming its subjects marks only those.
   */
  private open(v: Voice<I, O>): number {
    const epoch = ++this.epochs;
    if (v.named === null) {
      this.wide = epoch;
      return epoch;
    }
    for (const subject of v.named) {
      const slot = this.host.slotOf(subject);
      if (slot < 0 || slot >= this.cap) continue;
      const i = slot * SLOT + SEEN;
      const seen = this.per[i] as number;
      const from = seen < 0 ? -1 - seen : seen;
      this.per[i] = -1 - Math.min(from, epoch - 1);
    }
    return epoch;
  }

  /**
   * Takes the voices `touch` named on or off their crowds, each as it now stands; false at the
   * first that cannot be, which needs a qualify: one that leaves a lane or the general path, which
   * may open a channel, or one that joins anything but a crowd on a laned channel. Neither a voice
   * that fits joining laned channels nor a laned one leaving moves the fixed point `qualify` finds.
   * A crowd a quarter empty rows is compacted.
   */
  private retouch(): boolean {
    const touched = [...new Set(this.touched)].sort((a, b) => a.id - b.id);
    this.touched.length = 0;
    for (const v of touched) {
      const known = v.id <= this.known;
      if (v.id > this.known) this.known = v.id;
      const c = this.crowdOf.get(v.id);
      const p = c?.rowOf.get(v.id);
      if (c !== undefined && p !== undefined) {
        if (v.state === 'done') {
          this.bury(c, p);
          continue;
        }
        this.retouchRow(c, p, v);
        continue;
      }
      if (v.state === 'done' && !known) continue;
      const lane = this.byId.get(v.id);
      if (lane !== undefined) {
        if (!this.relane(lane)) return false;
        continue;
      }
      if (v.state === 'done') return false;
      // A locus's members are on lanes together or not at all, so one joining may move the others.
      if (v.spec.locus !== undefined) return false;
      const laned = v.slots.some((slot) => this.bySlot[slot] !== undefined);
      const fits = v.slots.length > 0 && this.host.fits(v);
      if (!laned && !fits) {
        this.whole = false;
        continue;
      }
      if (known || !fits || !laned || v.slots.some((slot) => this.bySlot[slot] === undefined))
        return false;
      if (crowdable(v)) this.join(v, undefined, undefined, this.crowds);
      else this.enlane(v);
    }
    this.compactSparse();
    // As a qualify leaving nothing on lanes: no fill comes to let go of what the last probes held.
    if (this.lanes.length === 0 && this.crowds.every((c) => c.dead === c.size)) this.subjects = [];
    return true;
  }

  /** A crowd row takes up its voice as it now stands: opened once it starts, its fields copied again. */
  private retouchRow(c: Crowd<I, O>, p: number, v: Voice<I, O>): void {
    const h = p * c.stride;
    if (c.hot[h + H_EPOCH] === 0 && v.state !== 'pending') c.hot[h + H_EPOCH] = this.open(v);
    c.hot[h + H_FLAGS] = (c.hot[h + H_FLAGS] as number) | F_VOICE;
  }

  /**
   * A new voice that fits and writes only laned channels, and that no crowd takes, gets a lane at
   * the end of the order, its id being past every other: what a qualify would give it, since such a
   * voice joining cannot unlane a channel.
   */
  private enlane(v: Voice<I, O>): void {
    const lane = new Lane<I, O>(v);
    v.laned = true;
    if (v.state !== 'pending') lane.epoch = this.open(v);
    lane.chans = v.slots.map((s) => this.bySlot[s] as Laned);
    lane.values = lane.chans.map(() => undefined);
    this.lanes.push(lane);
    this.byId.set(v.id, lane);
    if (v.named === null && lane.epoch > 0) this.dense.push(lane);
  }

  /**
   * A laned voice that started playing or finished, as a qualify would take it: a lane leaving
   * cannot lane or unlane another channel. False for a locus member, which a qualify must take.
   */
  private relane(lane: Lane<I, O>): boolean {
    const v = lane.voice;
    if (v.state !== 'done') {
      if (lane.epoch === 0 && v.state !== 'pending') {
        lane.epoch = this.open(v);
        if (v.named === null) this.dense.push(lane);
      }
      return true;
    }
    if (lane.group !== null) return false;
    this.leave(lane);
    this.lanes.splice(this.lanes.indexOf(lane), 1);
    const d = this.dense.indexOf(lane);
    if (d >= 0) this.dense.splice(d, 1);
    this.byId.delete(v.id);
    return true;
  }

  /**
   * Compacts every crowd a quarter or more empty rows: each fill walks every row, and at half a
   * crowd replacing a voice a frame carried as many empty rows as live ones.
   */
  private compactSparse(): void {
    for (const c of this.crowds) if (c.dead > 64 && c.dead * 4 >= c.size) this.compact(c);
  }

  /**
   * Slides a crowd's rows down over the empty ones its departed voices left, in order, so its rows
   * stay in voice order; a qualify did this by rebuilding every crowd, a dropped frame at 10k rows.
   */
  private compact(c: Crowd<I, O>): void {
    let q = 0;
    for (let p = 0; p < c.size; p++) {
      const v = c.voices[p] as Voice<I, O>;
      if (c.rowOf.get(v.id) !== p) {
        c.odd?.delete(p);
        continue;
      }
      if (q !== p) {
        this.copyRow(c, p, c, q);
        c.odd?.delete(p);
        c.rowOf.set(v.id, q);
      }
      q++;
    }
    c.list.length = q;
    c.voices.length = q;
    c.records.length = q;
    c.deltas.length = q;
    c.motions.length = q;
    c.eases.length = q;
    c.laws.length = q;
    c.touches.length = q;
    c.dead = 0;
  }

  /** A crowd voice left: its row stays, empty, until the crowds are next rebuilt. */
  private bury(c: Crowd<I, O>, p: number): void {
    const v = c.voices[p] as Voice<I, O>;
    this.leaveCrowd(c, p);
    c.list[p] = -1;
    c.records[p] = undefined;
    c.deltas[p] = null;
    c.motions[p] = undefined;
    c.hot[p * c.stride + H_FLAGS] = 0;
    c.rowOf.delete(v.id);
    this.crowdOf.delete(v.id);
    c.dead++;
  }

  private copyRow(from: Crowd<I, O>, p: number, to: Crowd<I, O>, q: number): void {
    to.list[q] = from.list[p] as number;
    to.data.set(from.data.subarray(p * STRIDE, (p + 1) * STRIDE), q * STRIDE);
    to.hot.set(from.hot.subarray(p * from.stride, (p + 1) * from.stride), q * to.stride);
    if (((from.hot[p * from.stride + H_FLAGS] as number) & F_STALE) !== 0) to.stale = true;
    to.samples.set(from.samples.subarray(p * from.axes, (p + 1) * from.axes), q * to.axes);
    to.deltas[q] = from.deltas[p] ?? null;
    to.records[q] = from.records[p];
    to.voices[q] = from.voices[p] as Voice<I, O>;
    to.motions[q] = from.motions[p];
    to.eases[q] = from.eases[p];
    to.laws[q] = from.laws[p] as Float64Array;
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
    c.restale(p, F_VOICE | (run === undefined ? 0 : F_MOTION));
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
    // Most crowds' voices share one law, so the last one found is checked before any key is made.
    const last = this.lastLaw;
    if (last !== null && run.hasLaw(last)) return last;
    const law = this.lawKeyed(run);
    this.lastLaw = law;
    return law;
  }

  private lawKeyed(run: Motions<I>): Float64Array {
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
    c.restale(p, c.hot[p * c.stride + H_FLAGS] as number);
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
      this.owed.clear();
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
      for (const lane of this.lanes) {
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
        if (c.stale) this.freshen(c);
        if (!c.idle && c.size > 0) busy = true;
      }
      if (busy) {
        for (const ch of this.laned) ch.values.fill(ch.rest, 0, size * ch.axes);
        for (const g of this.loci) this.gatherLocus(g);
        for (const lane of this.lanes) {
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

  /**
   * A voice with a signal weight: its weight for the subject at `slot` under the voice's fade `fade`,
   * through the general path's own arithmetic; NaN where that path has not made the voice's first
   * call for the subject, which it then makes this frame, so a signal that keeps state is first
   * called where the general path would call it.
   */
  private signalled(
    voice: Voice<I, O>,
    slot: number,
    rec: Subject<unknown>,
    elapsed: number,
    pass: number,
    fade: number,
  ): number {
    if (Number.isNaN(rec.probed)) {
      this.late.push(slot);
      return Number.NaN;
    }
    const subject = this.subjectAt(slot);
    if (subject === absent) return 0;
    const base = this.host.signal(voice, subject, rec, elapsed, pass);
    return weighed(base, fade, voice.parts === null ? 1 : this.host.parting(voice, subject));
  }

  /** What a subject's own ramp out of a voice leaves of its weight: 1 with none. */
  private parting(voice: Voice<I, O>, slot: number): number {
    if (voice.parts === null) return 1;
    const subject = this.subjectAt(slot);
    return subject === absent ? 1 : this.host.parting(voice, subject);
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

  /**
   * Every member of a locus, in voice order, gathered rather than folded: a member's delta for a
   * subject is lerped into what the members before it left there by its share of the weight
   * taken, as the general path's `foldLocus` does, so each subject's locus can fold in at its
   * first member's place in the order.
   */
  private gatherLocus(g: Locus<I, O>): void {
    const cap = this.cap;
    if (g.met.length < cap) {
      g.met = sized(g.met, cap);
      g.first = sized(g.first, cap);
      g.sum = sized(g.sum, cap);
    }
    for (let k = 0; k < g.values.length; k++) {
      const values = g.values[k];
      const taken = g.taken[k];
      const axes = (this.laned[k] as Laned).axes;
      if (values !== undefined) g.values[k] = sized(values, cap * axes);
      if (taken !== undefined) g.taken[k] = sized(taken, cap);
    }
    this.into = g;
    try {
      for (const lane of g.members) {
        const voice = lane.voice;
        if (lane.idle || voice.state === 'pending' || voice.state === 'done') continue;
        this.intoId = voice.id;
        this.reset(lane);
        const elapsed = voice.elapsedAt(this.now);
        const period = voice.patch.period;
        const passes = voice.passes;
        const list = lane.list;
        for (let p = 0; p < list.length; p++) {
          const slot = list[p] as number;
          if (this.one(lane, p, slot, elapsed, period, passes)) {
            this.meetLocus(g, slot);
            g.sum[slot] = (g.sum[slot] as number) + (lane.data[p * STRIDE + WEIGHT] as number);
          }
          if (voice.keeping) break;
        }
      }
    } finally {
      this.into = null;
    }
  }

  /** The first a fill hears of a subject in a locus: from the member now gathering. */
  private meetLocus(g: Locus<I, O>, slot: number): void {
    if (g.met[slot] === this.fills) return;
    g.met[slot] = this.fills;
    g.first[slot] = this.intoId;
    g.sum[slot] = 0;
    for (const taken of g.taken) if (taken !== undefined) taken[slot] = 0;
  }

  /** A member's value for one channel of a subject, lerped into its locus: `foldLocus`'s step. */
  private gatherInto(g: Locus<I, O>, ch: Laned, slot: number, value: unknown, w: number): void {
    this.meetLocus(g, slot);
    const k = ch.index;
    let values = g.values[k];
    let takenAt = g.taken[k];
    if (values === undefined || takenAt === undefined) {
      values = new Float64Array(this.cap * ch.axes);
      takenAt = new Float64Array(this.cap);
      g.values[k] = values;
      g.taken[k] = takenAt;
    }
    const taken = takenAt[slot] as number;
    const total = taken + w;
    const u = w / total;
    if (ch.scalar) {
      values[slot] =
        taken === 0 ? (value as number) : lerpNumber(values[slot] as number, value as number, u);
    } else {
      // Read past its end as the rest, as `vec`'s lerp and fold both read an array.
      const arr =
        Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<number>) : null;
      const base = slot * ch.axes;
      for (let a = 0; a < ch.axes; a++) {
        const v = arr === null ? ch.rest : (arr[a] ?? ch.rest);
        values[base + a] = taken === 0 ? v : lerpNumber(values[base + a] as number, v, u);
      }
    }
    takenAt[slot] = total;
  }

  /** A locus member's turn in the order: each subject it was the first member of takes the locus. */
  private foldLocus(lane: Lane<I, O>, g: Locus<I, O>): void {
    const id = lane.voice.id;
    const fills = this.fills;
    const list = lane.list;
    for (let p = 0; p < list.length; p++) {
      const slot = list[p] as number;
      if (g.met[slot] !== fills || g.first[slot] !== id) continue;
      const sum = g.sum[slot] as number;
      if (sum <= 0) continue;
      const w = sum > 1 ? 1 : sum;
      for (let k = 0; k < g.values.length; k++) {
        const takenAt = g.taken[k];
        if (takenAt === undefined || !((takenAt[slot] as number) > 0)) continue;
        const ch = this.laned[k] as Laned;
        const values = g.values[k] as Float64Array;
        const into = ch.values;
        const base = slot * ch.axes;
        for (let a = 0; a < ch.axes; a++)
          into[base + a] = foldNumber(
            ch.op,
            into[base + a] as number,
            values[base + a] as number,
            w,
          );
      }
    }
  }

  /** What a lane remembers within one fill, cleared before the fill runs it. */
  private reset(lane: Lane<I, O>): void {
    const voice = lane.voice;
    lane.placed = false;
    lane.read = false;
    lane.weighed = false;
    // With no fade in or out the envelope is 1 for every subject, which is what it would return.
    lane.flat = !((voice.fade.in ?? 0) > 0) && voice.out === null;
    lane.fade = 1;
  }

  /** One voice's contribution to every subject it plays on. */
  private run(lane: Lane<I, O>): void {
    const voice = lane.voice;
    if (voice.state === 'pending' || voice.state === 'done') return;
    if (lane.group !== null) {
      this.foldLocus(lane, lane.group);
      return;
    }
    this.reset(lane);
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

  /**
   * One subject's contribution from a lane's voice. True where the voice gave the subject a delta,
   * as the general path's `influence` does where it returns one, which is what makes a voice in a
   * locus one of its members for the subject.
   */
  private one(
    lane: Lane<I, O>,
    p: number,
    slot: number,
    elapsedNow: number,
    period: number,
    passes: number,
  ): boolean {
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
      return false;
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
    let w: number;
    if (typeof voice.spec.weight === 'function') {
      w = this.signalled(
        voice,
        slot,
        lane.records[p] as Subject<unknown>,
        elapsed,
        lane.pass,
        lane.fade,
      );
      if (Number.isNaN(w)) {
        data[o + WEIGHT] = 0;
        return false;
      }
    } else w = weighed(voice.weight, lane.fade, this.parting(voice, slot));
    data[o + WEIGHT] = w;
    if (voice.built !== null) {
      if (!lane.read || !Object.is(elapsed, lane.readAt)) {
        this.readKeyed(voice, lane.phase, lane.delta, lane.scratch);
        lane.read = true;
        lane.readAt = elapsed;
        this.gather(lane, lane.delta);
      }
      if (w > 0) this.fold(lane, slot, w);
      return true;
    }
    const rec = lane.records[p] as Subject<unknown>;
    // The general path makes a voice's first call for a subject, where it first sees it play.
    if (Number.isNaN(rec.probed)) {
      this.late.push(slot);
      return false;
    }
    // A motion patch needs the subject only to number it, so the lookup waits until then.
    if (lane.motion !== undefined) {
      this.move(lane, lane.motion, p, slot, rec, elapsed, delay, w);
      return true;
    }
    return this.call(voice, lane.chans, rec, slot, elapsed, lane.phase, lane.pass, delay, w);
  }

  /**
   * A keys voice's stops at `phase` folded straight into a subject's values, without a delta: what
   * `readKeyed` then `foldDelta` give, through the same segment search and the stock channels' own
   * lerp, which is all a laned keys voice can use.
   */
  private foldKeys(
    voice: Voice<I, O>,
    chans: readonly Laned[],
    phase: number,
    slot: number,
    w: number,
  ): void {
    const built = voice.built as NonNullable<Voice<I, O>['built']>;
    const tracks = built.tracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i] as Track;
      const ch = chans[i] as Laned;
      const found = segment(track, shifted(track, phase, built.period), undefined);
      if (found === NOTHING) continue;
      if (found === AT) {
        this.foldInto(ch, slot, seg.a, w);
        continue;
      }
      const a = seg.a;
      const b = seg.b;
      const u = seg.eased;
      if (ch.scalar) {
        this.foldInto(
          ch,
          slot,
          (voice.lerps[i] as (a: unknown, b: unknown, u: number) => unknown)(a, b, u),
          w,
        );
        continue;
      }
      // `vec`'s lerp, reading each end past its length as the rest, then its fold.
      const as = a as ArrayLike<number>;
      const bs = b as ArrayLike<number>;
      const values = ch.values;
      const base = slot * ch.axes;
      const rest = ch.rest;
      for (let x = 0; x < ch.axes; x++) {
        const v = lerpNumber(as[x] ?? rest, bs[x] ?? rest, u);
        values[base + x] = foldNumber(ch.op, values[base + x] as number, v, w);
      }
    }
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

  /**
   * Calls a stateless fn voice's patch for a subject its general path has met, and folds the delta;
   * false for a subject the host has let go of.
   */
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
  ): boolean {
    const host = this.host;
    const subject = this.subjectAt(slot);
    if (subject === absent) return false;
    // Called already this frame, by the general path or a fill before a refill: reuse, as a probe does.
    if (rec.probed === this.now && rec.delta !== null && rec.seeks === voice.seeks) {
      if (w > 0) this.foldDelta(chans, slot, rec.delta, w);
      return true;
    }
    const kept = reading.kept;
    host.ready(voice, subject, rec, elapsed, pass, w);
    if (this.keeps) host.horizon(voice, delay);
    else reading.horizon = Number.POSITIVE_INFINITY;
    const delta = voice.patch.at(phase, subject, voice.setting as never) as Record<string, unknown>;
    // What `influence` leaves on the record, so a probe on the general path this frame reuses it.
    rec.delta = delta;
    rec.probed = this.now;
    rec.seeks = voice.seeks;
    if (this.keeps) host.after(voice, rec);
    if (reading.kept !== kept && !voice.keeping) host.kept(voice);
    if (w > 0) this.foldDelta(chans, slot, delta, w);
    return true;
  }

  /** Runs every crowd's rows whose voices come before voice `id`, from where each crowd reached. */
  private crowdsUpTo(id: number): void {
    if (!this.overlap) {
      for (const c of this.crowds) if (!c.idle && c.cursor < c.size) this.runCrowd(c, id);
      return;
    }
    // Crowds sharing a channel take turns in voice order, so a subject's rows fold as one crowd's do.
    for (;;) {
      let first: Crowd<I, O> | undefined;
      let a = id;
      let b = id;
      for (const c of this.crowds) {
        if (c.idle || c.cursor >= c.size) continue;
        const next = c.hot[c.cursor * c.stride + H_ID] as number;
        if (next < a) {
          b = a;
          a = next;
          first = c;
        } else if (next < b) b = next;
      }
      if (first === undefined) return;
      this.runCrowd(first, b);
    }
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
      else if (typeof voice.spec.weight === 'function') {
        w = this.signalled(
          voice,
          slot,
          c.records[p] as Subject<unknown>,
          elapsed,
          passAt(elapsed, voice.patch.period, voice.passes),
          this.host.envelope(voice, data[o + SINCE] as number),
        );
        if (Number.isNaN(w)) {
          data[o + WEIGHT] = 0;
          continue;
        }
      } else
        w = weighed(
          voice.weight,
          this.host.envelope(voice, data[o + SINCE] as number),
          this.parting(voice, slot),
        );
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
      if (
        ms < 0 ||
        (f & F_BARE) === 0 ||
        (probed &&
          ((per[q + LANE_PROBE] as number) > from || (per[q + GENERAL_PROBE] as number) > from))
      ) {
        const run = c.motions[p] as Motions<I>;
        this.move(c, run, p, slot, c.records[p] as Subject<unknown>, elapsed, delay, w);
        // The first sample numbered the subject in the patch: copy its stretch from the next fill.
        if (ms < 0) c.restale(p, hot[h + H_FLAGS] as number);
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
      if (w > 0) this.foldKeys(voice, c.chans, phase, slot, w);
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
      !v.keeping &&
      typeof v.spec.weight !== 'function'
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

  /**
   * Copies stale motion rows' stretches as a fill begins: inside `runCrowd`, once voices came and
   * went, TurboFan spent its inlining on the copy and stopped inlining every row's ease.
   */
  private freshen(c: Crowd<I, O>): void {
    c.stale = false;
    const hot = c.hot;
    const H = c.stride;
    for (let p = 0; p < c.list.length; p++) {
      const f = hot[p * H + H_FLAGS] as number;
      if ((f & F_STALE) === 0 || (f & F_MOTION) === 0) continue;
      // A row with no stretch yet is marked again once its first sample numbers it.
      const ms = c.data[p * STRIDE + MSLOT] as number;
      if (ms >= 0) this.copyStretch(c, p, ms);
    }
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
    const signal = typeof voice.spec.weight === 'function';
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
      // Its signal just made kept state: no further call this fill, the general path makes them.
      if (signal && voice.keeping) return;
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
      let w: number;
      if (signal) {
        w = this.signalled(
          voice,
          slot,
          records[p] as Subject<unknown>,
          elapsed,
          passAt(elapsed, voice.patch.period, voice.passes),
          lane.fade,
        );
        if (Number.isNaN(w)) {
          data[o + WEIGHT] = 0;
          continue;
        }
      } else
        w = flat && !parts ? whole : weighed(voice.weight, lane.fade, this.parting(voice, slot));
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
      if (this.keeps) this.host.horizon(voice, delay);
      else reading.horizon = Number.POSITIVE_INFINITY;
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
    if (this.into !== null) {
      this.gatherInto(this.into, ch, slot, value, w);
      return;
    }
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
