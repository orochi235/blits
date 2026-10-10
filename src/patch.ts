import { type LerpInto, lerpInto, lerpNumber } from './channels.js';
import { type Curve, curve, startSlope } from './easing.js';
import type { Channel, Easing, Keyframe, Kit, Patch, Setting } from './types.js';

/**
 * What `patch` takes besides its duration and its function.
 *
 * @category patch
 */
export interface PatchOptions<I, O, S, H = unknown> {
  /** The channels this patch contributes to. Every key `at` sets, and no others. Default: `kit`'s. */
  writes?: readonly (keyof O)[];
  /** The channels this patch was written against, which `cue` checks a mix's kit against. */
  kit?: Partial<Kit<O>>;
  /** The fields of `setting.host` this patch reads, which `cue` checks the mix's host for. */
  reads?: readonly string[];
  state?(subject: I): S;
  step?(state: S, dt: number, subject: I, setting: Setting<S, H>): void;
  /** `state` as plain data and back, for a history store: see `Patch.pack`. */
  pack?(state: S): unknown;
  unpack?(data: unknown): S;
}

/**
 * The procedural form. Flicker, roving, a hash walk, a starter strike.
 *
 * @category patch
 */
export function patch<I, O, S = void, H = unknown>(
  duration: number,
  at: (phase: number, subject: I, setting: Setting<S, H>) => Partial<O>,
  opts: PatchOptions<I, O, S, H>,
): Patch<I, O, S, H> {
  const writes = opts.writes ?? (opts.kit ? (Object.keys(opts.kit) as (keyof O)[]) : undefined);
  if (writes === undefined)
    throw new Error('blits: a patch needs writes, or a kit to take them from');
  return {
    form: 'fn',
    duration,
    period: duration,
    writes,
    kit: opts.kit,
    reads: opts.reads,
    at,
    state: opts.state,
    step: opts.step,
    pack: opts.pack,
    unpack: opts.unpack,
  };
}

/**
 * What `keys` takes besides its duration and its stops.
 *
 * @category patch
 */
export interface KeysOptions<O> {
  /** The curve every segment takes unless a stop or `easeBy` overrides it. */
  ease?: Easing;
  /** A curve for one channel, where it differs from the rest. */
  easeBy?: (channel: keyof O) => Easing | undefined;
  /** Milliseconds one channel waits before it starts moving; it then travels in the time left. */
  delayBy?: (channel: keyof O) => number;
  /**
   * How one channel interpolates, where it should differ from the channel's own `lerp`. A mix hands
   * every keyed channel its kit's `lerp` unless this names one.
   */
  lerpBy?: (channel: keyof O) => ((a: never, b: never, u: number) => unknown) | undefined;
  /** The channels these stops were written against, which `cue` checks a mix's kit against. */
  kit?: Partial<Kit<O>>;
}

const linear = (a: number, b: number, u: number) => a + (b - a) * u;

function interpolate(a: unknown, b: unknown, u: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return linear(a, b, u);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = new Array<unknown>(a.length);
    for (let i = 0; i < a.length; i++) out[i] = interpolate(a[i], b[i], u);
    return out;
  }
  return u < 0.5 ? a : b;
}

interface Point {
  at: number;
  value: unknown;
  /** The curve into this point from the one before: the stop's own, else the channel's. */
  ease: Curve | undefined;
}

type Lerp = (a: never, b: never, u: number) => unknown;

/** One channel of a stop list, sorted and resolved once, so a read is a binary search. */
export interface Track {
  channel: string;
  /** Every stop carrying this channel, by phase. */
  all: Point[];
  /** The same without stops at 0, which a `from: 'current'` base replaces. */
  tail: Point[];
  /** The phases of `all`, which the search reads, and of `tail`, made on its first search. */
  ats: number[];
  tailAts: number[] | null;
  delay: number;
  lerp: ((a: never, b: never, u: number) => unknown) | undefined;
  /** Where every stop is a plain number lerped straight across: the stops flat, for `readNumber`. */
  numbers: { ats: Float64Array; values: Float64Array; eases: (Curve | undefined)[] } | null;
}

export interface Built {
  tracks: Track[];
  duration: number;
}

function build<O>(
  stops: readonly Keyframe<O>[],
  writes: readonly (keyof O)[],
  duration: number,
  opts: KeysOptions<O>,
): Built {
  const fallback = opts.ease === undefined ? undefined : curve(opts.ease);
  const tracks: Track[] = [];
  for (const channel of writes) {
    const own = opts.easeBy?.(channel);
    const trackEase = own === undefined ? fallback : curve(own);
    const all: Point[] = [];
    for (const stop of stops) {
      const value = stop.delta[channel];
      if (value === undefined) continue;
      all.push({
        at: stop.at,
        // A copy, so every reader sees the stop as it was built: a lane may hold its numbers.
        value: Array.isArray(value)
          ? [...value]
          : ArrayBuffer.isView(value)
            ? (value as unknown as { slice(): unknown }).slice()
            : value,
        ease: stop.ease === undefined ? trackEase : curve(stop.ease),
      });
    }
    all.sort((x, y) => x.at - y.at);
    const tail = all.filter((pt) => pt.at !== 0);
    const lerp = opts.lerpBy?.(channel) ?? (opts.kit?.[channel]?.lerp as Track['lerp']);
    const plain =
      all.length > 0 &&
      (lerp === undefined || lerp === (lerpNumber as Lerp)) &&
      all.every((pt) => typeof pt.value === 'number');
    tracks.push({
      channel: channel as string,
      all,
      tail,
      ats: all.map((pt) => pt.at),
      tailAts: null,
      delay: opts.delayBy?.(channel) ?? 0,
      lerp,
      numbers: plain
        ? {
            ats: Float64Array.from(all, (pt) => pt.at),
            values: Float64Array.from(all, (pt) => pt.value as number),
            eases: all.map((pt) => pt.ease),
          }
        : null,
    });
  }
  return { tracks, duration };
}

/** What `segment` found: nothing to read, one value, or a segment to interpolate along. */
export const NOTHING = 0;
export const AT = 1;
export const BETWEEN = 2;

/**
 * Where `segment` leaves a track's reading: the value, or the segment's two ends, how far along it
 * is before and after its easing, whether it leaves `base`, its length and its easing. Read it
 * before anything else reads a track.
 */
export const seg = {
  a: undefined as unknown,
  b: undefined as unknown,
  u: 0,
  eased: 0,
  first: false,
  len: 0,
  ease: undefined as Curve | undefined,
};

/** A track's phase once its channel's own delay applies. */
export function shifted(track: Track, phase: number, duration: number): number {
  return shift(track.delay, phase, duration);
}

/** A phase once a channel's delay of `delay` ms in a duration of `duration` applies. */
export function shift(delay: number, phase: number, duration: number): number {
  if (delay === 0 || duration === 0) return phase;
  // The channel travels in what is left after its wait, so it lands with the rest at phase 1.
  if (delay >= duration) return phase >= 1 ? 1 : 0;
  return Math.max(0, (phase * duration - delay) / (duration - delay));
}

/**
 * Where `phase` falls among `n` stop phases `ats[off + k * stride]`, in order: -2 for no stops, -1
 * at or before the first, `n` at or past the last, and otherwise the first stop past it, where the
 * segment from the one before ends. With `segment`'s, the one copy of the search.
 */
export function locate(
  ats: ArrayLike<number>,
  off: number,
  stride: number,
  n: number,
  phase: number,
): number {
  if (n === 0) return -2;
  if (phase <= (ats[off] as number)) return -1;
  if (phase >= (ats[off + (n - 1) * stride] as number)) return n;
  return firstPast(ats, off, stride, 1, n - 1, phase);
}

/** The first of stops `lo` to `hi` whose phase is at or past `phase`, the last known to be. */
function firstPast(
  ats: ArrayLike<number>,
  off: number,
  stride: number,
  lo: number,
  hi: number,
  phase: number,
): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((ats[off + mid * stride] as number) >= phase) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** How far along a segment from phase `a` to `b` a phase is, before easing. */
export function fraction(phase: number, a: number, b: number): number {
  return (phase - a) / (b - a);
}

/**
 * Finds where one track is at a phase, into `seg`: the one copy of the search, which `read` and a
 * lane folding stops straight into a subject's values both make. `base` stands in for the value at
 * phase 0, which is how `from: 'current'` starts a voice wherever the subject already is.
 */
export function segment(track: Track, phase: number, base: unknown): number {
  let lo: number;
  const o = base === undefined ? 0 : 1;
  const pts = o === 0 ? track.all : track.tail;
  if (o === 0) {
    const n = pts.length;
    lo = locate(track.ats, 0, 1, n, phase);
    if (lo === -2) return NOTHING;
    if (lo === -1 || lo === n) {
      seg.a = (pts[lo === -1 ? 0 : n - 1] as Point).value;
      return AT;
    }
  } else {
    // Stop 0 is `base`, at phase 0, and stop k is the tail's k - 1.
    const n = pts.length + 1;
    if (phase <= 0) {
      seg.a = base;
      return AT;
    }
    const last = pts[pts.length - 1] as Point | undefined;
    if (last === undefined || phase >= last.at) {
      seg.a = last === undefined ? base : last.value;
      return AT;
    }
    track.tailAts ??= pts.map((pt) => pt.at);
    lo = firstPast(track.tailAts, -1, 1, 1, n - 1, phase);
  }
  const b = pts[lo - o] as Point;
  const aAt = lo - 1 < o ? 0 : (pts[lo - 1 - o] as Point).at;
  const u = fraction(phase, aAt, b.at);
  // Before any of `seg` is written, so an easing that reads stops itself cannot overwrite it.
  const eased = b.ease ? b.ease(u) : u;
  seg.a = lo - 1 < o ? base : (pts[lo - 1 - o] as Point).value;
  seg.b = b.value;
  seg.u = u;
  seg.eased = eased;
  seg.first = lo - 1 < o;
  seg.len = b.at - aAt;
  seg.ease = b.ease;
  return BETWEEN;
}

/**
 * A plain-number track at a phase, in exactly `segment`'s and `read`'s arithmetic: the stop at or
 * past the phase by binary search, the fraction before easing, then a straight lerp.
 */
function readNumber(t: NonNullable<Track['numbers']>, phase: number): number {
  const ats = t.ats;
  const values = t.values;
  const n = ats.length;
  if (phase <= (ats[0] as number)) return values[0] as number;
  if (phase >= (ats[n - 1] as number)) return values[n - 1] as number;
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((ats[mid] as number) >= phase) hi = mid;
    else lo = mid + 1;
  }
  const a = ats[lo - 1] as number;
  const u = (phase - a) / ((ats[lo] as number) - a);
  const ease = t.eases[lo];
  const eased = ease ? ease(u) : u;
  const from = values[lo - 1] as number;
  return from + ((values[lo] as number) - from) * eased;
}

/** Reads one track at a phase; `base` as `segment` takes it. */
function read(
  track: Track,
  phase: number,
  base: unknown,
  lerp: Lerp | undefined,
  /** Units per ms, for a retarget's first segment. */
  slope: unknown,
  duration: number,
  into: LerpInto | undefined,
  reuse: unknown[] | undefined,
): unknown {
  const numbers = track.numbers;
  if (
    numbers !== null &&
    base === undefined &&
    slope === undefined &&
    (lerp === undefined || lerp === (lerpNumber as Lerp) || track.lerp !== undefined)
  )
    return readNumber(numbers, phase);
  const found = segment(track, phase, base);
  if (found === NOTHING) return undefined;
  if (found === AT) return seg.a;
  const aValue = seg.a;
  const bValue = seg.b;
  const u = seg.u;
  const eased = seg.eased;
  const first = seg.first;
  const len = seg.len;
  const ease = seg.ease;
  let value: unknown;
  if (into !== undefined) {
    value = into(reuse, aValue, bValue, eased);
    lastRead.wrote = value;
  } else {
    const by = track.lerp ?? lerp;
    value = by ? by(aValue as never, bValue as never, eased) : interpolate(aValue, bValue, eased);
  }
  // Leaving a retarget's base, bend the first segment so it starts at the slope the subject had:
  // add c·u(1−u)², which is 0 at both ends, flat at the end, and fixes the slope at the start.
  if (slope === undefined || !first) return value;
  const e0 = ease ? startSlope(ease) : 1;
  if (e0 === Number.POSITIVE_INFINITY) return value;
  const bend = (s: number, a: number, z: number) =>
    (s * duration * len - (z - a) * e0) * u * (1 - u) * (1 - u);
  if (typeof value === 'number' && typeof slope === 'number')
    return value + bend(slope, aValue as number, bValue as number);
  if (Array.isArray(value) && Array.isArray(slope)) {
    const out = value === lastRead.wrote ? value : new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const s = slope[i];
      out[i] =
        typeof v === 'number' && typeof s === 'number'
          ? v + bend(s, (aValue as number[])[i] as number, (bValue as number[])[i] as number)
          : v;
    }
    return out;
  }
  return value;
}

/** The array the last `read` interpolated into, which only its caller's record holds. */
const lastRead: { wrote: unknown } = { wrote: undefined };

/**
 * Arrays a reader lets keyed reads interpolate into, by track. Each only ever holds what a read made,
 * never a stop's or a base's, and a delta read through it is good until the next read through it.
 */
export type Scratch = (unknown[] | undefined)[];

/**
 * Per track, the in-place form of the `lerp` a read takes, where it is the mix channel's own and the
 * channel has one. `channels` holds the mix's channel per track, in `writes` order.
 */
export function intosOf(
  built: Built,
  channels: readonly Channel<unknown>[],
): (LerpInto | undefined)[] {
  return built.tracks.map((track, i) => {
    const channel = channels[i] as Channel<unknown>;
    return track.lerp === undefined || track.lerp === channel.lerp ? lerpInto(channel) : undefined;
  });
}

/**
 * Evaluates built stops into `out`; a channel with nothing to read at this phase is left undefined.
 * `lerps` holds the mix's channel `lerp` per track, in `writes` order, for a track the patch did not
 * give one.
 */
export function readKeys(
  built: Built,
  phase: number,
  out: Record<string, unknown>,
  base?: Record<string, unknown>,
  lerps?: readonly (Lerp | undefined)[],
  /** Per channel, how fast a retargeted subject was moving, units per ms. */
  slopes?: Record<string, unknown>,
  intos?: readonly (LerpInto | undefined)[],
  scratch?: Scratch,
): Record<string, unknown> {
  const duration = built.duration;
  for (let i = 0; i < built.tracks.length; i++) {
    const track = built.tracks[i] as Track;
    const perMs = slopes?.[track.channel];
    const into = scratch === undefined ? undefined : intos?.[i];
    lastRead.wrote = undefined;
    const value = read(
      track,
      shifted(track, phase, duration),
      base?.[track.channel],
      lerps?.[i],
      duration === 0 ? undefined : perMs,
      duration,
      into,
      into === undefined ? undefined : (scratch as Scratch)[i],
    );
    if (into !== undefined && value === lastRead.wrote)
      (scratch as Scratch)[i] = value as unknown[];
    if (value !== undefined) out[track.channel] = value;
    else if (out[track.channel] !== undefined) out[track.channel] = undefined;
  }
  return out;
}

/** A patch's `duration`, or the deprecated `period` where only that is set. */
export const durationOf = <I, O, S>(p: Patch<I, O, S>): number => p.duration ?? p.period ?? 0;

const cache = new WeakMap<object, Built>();

/**
 * The built form of a patch's stops, made on first ask for a patch `keys()` did not build: a copy
 * of one, or one another copy of blits made, each read by the fields it carries.
 */
export function builtOf<I, O, S>(p: Patch<I, O, S>): Built {
  let held = cache.get(p);
  if (held === undefined) {
    held = build(p.keys as readonly Keyframe<O>[], p.writes, durationOf(p), p);
    cache.set(p, held);
  }
  return held;
}

/** Evaluates a stop list into a fresh delta. */
export function evalKeys<O>(
  stops: readonly Keyframe<O>[],
  writes: readonly (keyof O)[],
  phase: number,
  duration: number,
  opts: KeysOptions<O>,
  base?: Partial<O>,
): Partial<O> {
  return readKeys(build(stops, writes, duration, opts), phase, {}, base as never) as Partial<O>;
}

/**
 * The declarative form. klieg's transition sugar and wod's keyframes.
 *
 * @category patch
 */
export function keys<I, O>(
  duration: number,
  stops: readonly Keyframe<O>[],
  opts: KeysOptions<O> = {},
): Patch<I, O, void> {
  const writes = [...new Set(stops.flatMap((s) => Object.keys(s.delta) as (keyof O)[]))];
  const made = build(stops, writes, duration, opts);
  const p: Patch<I, O, void> = {
    form: 'keys',
    duration,
    period: duration,
    writes,
    kit: opts.kit,
    keys: stops,
    ...given(opts),
    // A copy of the patch carries this `at` with fields of its own, which it is read by.
    at(phase) {
      return readKeys(this === p ? made : builtOf(this), phase, {}) as Partial<O>;
    },
  };
  cache.set(p, made);
  return p;
}

/** The `keys` options a patch carries as fields, those given only: an absent one adds no key. */
function given<O>(opts: KeysOptions<O>): Partial<Patch<never, O>> {
  const out: { -readonly [K in keyof Patch<never, O>]?: Patch<never, O>[K] } = {};
  if (opts.ease !== undefined) out.ease = opts.ease;
  if (opts.easeBy !== undefined) out.easeBy = opts.easeBy;
  if (opts.delayBy !== undefined) out.delayBy = opts.delayBy;
  if (opts.lerpBy !== undefined) out.lerpBy = opts.lerpBy;
  return out;
}
