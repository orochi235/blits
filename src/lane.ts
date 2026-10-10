import { unbareLane } from './bare.js';
import type { Numeric } from './channels.js';
import { frozenTime } from './clock.js';
import { motionOf } from './motion.js';
import type { Motions } from './motions.js';
import type { Scratch } from './patch.js';
import type { Channel } from './types.js';
import type { Subject, Voice } from './voice.js';

/** One laned channel: its arithmetic, and every numbered subject's folded value, `axes` per subject. */
export interface Laned {
  name: string;
  /** Its value is a number, its rest a number; otherwise an array, which `vec(1)` is too. */
  scalar: boolean;
  op: Numeric['op'];
  /** Its values fold as its `op` alone: not through a band as `'last'` does, and not a rotation. */
  plain: boolean;
  /** An angle's full turn, and 0 for any other channel. */
  turn: number;
  /** The channel, whose own `fold` and `lerp` an `'own'` lane calls. */
  channel: Channel<unknown>;
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
export interface Locus<I, O> {
  readonly members: Lane<I, O>[];
  /** By subject number: the fill that last met it, the member it met first then, the summed weight. */
  met: Float64Array;
  first: Float64Array;
  sum: Float64Array;
  /** By laned channel, then subject number (times axes for `values`). */
  values: (Float64Array | undefined)[];
  taken: (Float64Array | undefined)[];
}

/**
 * Where each of a lane position's or crowd row's `STRIDE` numbers sits. The layouts are const
 * enums so tsc writes each member in as a number: V8 reads a const imported from another module on
 * every use, which cost the fills 10-20%.
 */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package
export const enum Row {
  STRIDE = 8,
  DELAY = 0,
  SINCE = 1,
  /** The weight the last fill gave the subject. */
  WEIGHT = 2,
  /** The weight a fill gave it the last time a probe read it from the lane. */
  PROBED = 3,
  MSLOT = 4,
  /** For a motion voice, the last fill that sampled the subject, and the voice's seeks then. */
  SAMPLED = 5,
  SEEKS = 6,
  /** 1 once the general path has made the voice's first call for the subject, which never undoes. */
  MET = 7,
}

/** What `begin` found: the general path, or lanes filled. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package
export const enum Begin {
  GENERAL = 0,
  READY = 1,
}

/**
 * Where each number a fill hands from one of its methods to the next sits in `Lanes.arg`. Passed as
 * an argument, a double is boxed wherever V8 does not inline the call: 16 bytes a number a subject
 * (bench/allocs.mjs, 2026-10-09). The caller writes them just before the call, and the callee reads
 * them before it calls anything else.
 */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package
export const enum Arg {
  /** The weight to fold at. */
  WEIGHT = 0,
  /** The subject's voice time, its freezes applied. */
  ELAPSED = 1,
  PHASE = 2,
  PASS = 3,
  DELAY = 4,
  /** The voice's own fade, for `signalled`. */
  FADE = 5,
  SIZE = 6,
}

/** Where each of a subject's `SLOT` numbers in `Lanes.per` sits. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package
export const enum Per {
  SLOT = 6,
  FILLED = 0,
  /**
   * The latest epoch a probe has checked the subject against; or, as `-1 - e`, that a voice naming
   * it started after epoch `e`, so its next probe checks it against everything since `e`.
   */
  SEEN = 1,
  IDLE = 2,
  LANE_PROBE = 3,
  GENERAL_PROBE = 4,
  LANE_FILL = 5,
}

/**
 * Below what share of its subjects probed last frame a lane stops filling, and above what share it
 * fills again; between the two it keeps doing what it did, so a host near the line does not flip
 * every frame. Measured at 10k and 1k subjects (2026-10-02, one local machine): filling breaks even
 * with probing through the general path at about 19% probed for keys at both sizes, 71-77% for a
 * spring, and 63% (1k) to about 100% (10k) for a stateless fn.
 */
export const SPARSE = { keys: { stop: 0.15, start: 0.25 }, other: { stop: 0.6, start: 0.8 } };

/** What pacing reads and sets: a lane's or a crowd's subjects, idle state and per-position numbers. */
export interface Paced {
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
  /** Makes position `p`'s sample and its stamps hold what its last fill gave it. */
  fix(p: number): void;
  /** Position `p`'s subject has number `ms` in its voice's motion patch. */
  numbered(p: number, ms: number): void;
  motionAt(p: number): Motions<I> | undefined;
}

/**
 * What one laned voice keeps per subject it reaches, by position in `list`. A subject gets a
 * position when a probe of it first finds the voice playing, which is when the general path first
 * sees it too.
 */
export class Lane<I, O> implements Positions<I, O> {
  /** The subject number at each position. */
  readonly list: number[] = [];
  /** By subject number, its position plus one, 0 where it has none. */
  private at = new Int32Array(0);
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
  /** A keys read's `values` as numbers, each channel's axes side by side, and how each folds. */
  nums = new Float64Array(0);
  kinds = new Uint8Array(0);
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
  /** The voice's clock at this fill, set before `one` runs its subjects. */
  elapsedNow = 0;
  /** A motion patch's state, which the lane samples in place of calling the patch. */
  readonly motion: Motions<I> | undefined;
  /** By the motion patch's number for a subject, its position plus one, 0 where it has none. */
  private byMotion = new Int32Array(0);
  /** The last fill `runMotion` ran, and its voice time and seeks, which a `Sampled.BARE` position was sampled at. */
  bareFill = -1;
  bareElapsed = Number.NaN;
  bareSeeks = Number.NaN;
  /** The locus its voice shares, gathered before the voices are folded in order. */
  group: Locus<I, O> | null = null;

  voiceAt(): Voice<I, O> {
    return this.voice;
  }

  fix(p: number): void {
    unbareLane(this, p);
  }

  numbered(p: number, ms: number): void {
    if (ms >= this.byMotion.length) {
      const at = new Int32Array(Math.max(ms + 1, this.byMotion.length * 2, 64));
      at.set(this.byMotion);
      this.byMotion = at;
    }
    this.byMotion[ms] = p + 1;
  }

  positionOfMotion(ms: number): number {
    return ms < this.byMotion.length ? (this.byMotion[ms] as number) - 1 : -1;
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
    return slot < this.at.length ? (this.at[slot] as number) - 1 : -1;
  }

  /** Gives a subject the voice reaches a position, from what its record fixed on first sight. */
  add(slot: number, held: Subject<unknown>): void {
    const p = this.list.length;
    this.list.push(slot);
    if (slot >= this.at.length) {
      const at = new Int32Array(Math.max(slot + 1, this.at.length * 2, 64));
      at.set(this.at);
      this.at = at;
    }
    this.at[slot] = p + 1;
    if ((p + 1) * Row.STRIDE > this.data.length) {
      const data = new Float64Array(
        Math.max(p + 1, (this.data.length / Row.STRIDE) * 2, 4) * Row.STRIDE,
      );
      data.set(this.data);
      this.data = data;
    }
    const o = p * Row.STRIDE;
    this.data[o + Row.DELAY] = held.delay;
    this.data[o + Row.SINCE] = held.shown;
    this.data[o + Row.WEIGHT] = 0;
    this.data[o + Row.PROBED] = 0;
    this.data[o + Row.MSLOT] = -1;
    this.data[o + Row.SAMPLED] = -1;
    this.data[o + Row.MET] = 0;
    this.records[p] = held;
    this.deltas[p] = null;
  }

  /** A subject lost its number: the last position moves into its place. */
  remove(slot: number): void {
    const p = this.positionOf(slot);
    if (p < 0) return;
    const last = this.list.length - 1;
    const ms = this.data[p * Row.STRIDE + Row.MSLOT] as number;
    if (ms >= 0) this.byMotion[ms] = 0;
    if (p !== last) {
      const number = this.data[last * Row.STRIDE + Row.MSLOT] as number;
      if (number >= 0) this.byMotion[number] = p + 1;
      const moved = this.list[last] as number;
      this.list[p] = moved;
      this.at[moved] = p + 1;
      this.data.copyWithin(p * Row.STRIDE, last * Row.STRIDE, (last + 1) * Row.STRIDE);
      this.records[p] = this.records[last];
      this.deltas[p] = this.deltas[last] ?? null;
      const n = this.axes;
      if (n > 0) this.samples.copyWithin(p * n, last * n, (last + 1) * n);
    }
    this.list.pop();
    this.at[slot] = 0;
    this.records[last] = undefined;
    this.deltas[last] = null;
  }
}

/**
 * A subject's voice time once its voice's freezes apply: frozen at 0 before it starts and at the end
 * of its passes after, and NaN where it shows nothing.
 */
export function frozenAt<I, O>(voice: Voice<I, O>, elapsed: number): number {
  return frozenTime(elapsed, voice.freezesBefore, voice.freezesAfter, voice.span);
}
