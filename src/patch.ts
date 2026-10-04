import { type LerpInto, lerpInto, mix } from './channels.js';
import { type Curve, curve } from './easing.js';
import type { Channel, Easing, Keyframe, Kit, Patch, Setting } from './types.js';

/**
 * What `patch` takes besides its period and its function.
 *
 * @category patch
 */
export interface PatchOptions<I, O, S> {
  /** The channels this patch contributes to. Every key `at` sets, and no others. Default: `kit`'s. */
  writes?: readonly (keyof O)[];
  /** The channels this patch was written against, which `cue` checks a mix's kit against. */
  kit?: Partial<Kit<O>>;
  /** The fields of `setting.host` this patch reads, which `cue` checks the mix's host for. */
  reads?: readonly string[];
  state?(subject: I): S;
  step?(state: S, dt: number, subject: I, setting: Setting<S>): void;
}

/**
 * The procedural form. Flicker, roving, a hash walk, a starter strike.
 *
 * @category patch
 */
export function patch<I, O, S = void>(
  period: number,
  at: (phase: number, subject: I, setting: Setting<S>) => Partial<O>,
  opts: PatchOptions<I, O, S>,
): Patch<I, O, S> {
  const writes = opts.writes ?? (opts.kit ? (Object.keys(opts.kit) as (keyof O)[]) : undefined);
  if (writes === undefined)
    throw new Error('blits: a patch needs writes, or a kit to take them from');
  return {
    form: 'fn',
    period,
    writes,
    kit: opts.kit,
    reads: opts.reads,
    at,
    state: opts.state,
    step: opts.step,
  };
}

/**
 * What `keys` takes besides its period and its stops.
 *
 * @category patch
 */
export interface KeysOptions<O> {
  /** The curve every segment takes unless a stop or `easeBy` overrides it. */
  ease?: Easing;
  /** A curve for one channel, where it differs from the rest. */
  easeBy?: (channel: keyof O) => Easing | undefined;
  /** Milliseconds one channel waits before it starts moving, within the period. */
  delayBy?: (channel: keyof O) => number;
  /**
   * How one channel interpolates, where it should differ from the channel's own `lerp`. A mix hands
   * every keyed channel its kit's `lerp` unless this names one.
   */
  lerpBy?: (channel: keyof O) => ((a: never, b: never, u: number) => unknown) | undefined;
  /** The channels these stops were written against, which `cue` checks a mix's kit against. */
  kit?: Partial<Kit<O>>;
}

const options = new WeakMap<Patch<never, never, never>, KeysOptions<unknown>>();

/** The options a `keys` patch was built with, for an engine reading its stops rather than calling it. */
export function keysOptionsOf<I, O, S>(p: Patch<I, O, S>): KeysOptions<O> | undefined {
  return options.get(p as unknown as Patch<never, never, never>) as KeysOptions<O> | undefined;
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
interface Track {
  channel: string;
  /** Every stop carrying this channel, by phase. */
  all: Point[];
  /** The same without stops at 0, which a `from: 'current'` base replaces. */
  tail: Point[];
  /** The phase of each of `all`, and of a base at 0 followed by each of `tail`. */
  ats: Float64Array;
  tailAts: Float64Array;
  delay: number;
  lerp: ((a: never, b: never, u: number) => unknown) | undefined;
}

export interface Built {
  tracks: Track[];
  period: number;
}

function build<O>(
  stops: readonly Keyframe<O>[],
  writes: readonly (keyof O)[],
  period: number,
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
        value,
        ease: stop.ease === undefined ? trackEase : curve(stop.ease),
      });
    }
    all.sort((x, y) => x.at - y.at);
    const tail = all.filter((pt) => pt.at !== 0);
    tracks.push({
      channel: channel as string,
      all,
      tail,
      ats: Float64Array.from(all, (pt) => pt.at),
      tailAts: Float64Array.from([0, ...tail.map((pt) => pt.at)]),
      delay: opts.delayBy?.(channel) ?? 0,
      lerp: opts.lerpBy?.(channel) ?? (opts.kit?.[channel]?.lerp as Track['lerp']),
    });
  }
  return { tracks, period };
}

/**
 * Reads one track at a phase. `base` stands in for the value at phase 0, which is how
 * `from: 'current'` starts a voice wherever the subject already is.
 */
function read(
  track: Track,
  phase: number,
  base: unknown,
  lerp: Lerp | undefined,
  /** Units per ms, for a retarget's first segment. */
  slope: unknown,
  period: number,
  into: LerpInto | undefined,
  reuse: unknown[] | undefined,
): unknown {
  const pts = base === undefined ? track.all : track.tail;
  const o = base === undefined ? 0 : 1;
  const n = pts.length + o;
  if (n === 0) return undefined;
  const firstAt = o === 1 ? 0 : (pts[0] as Point).at;
  if (phase <= firstAt) return o === 1 ? base : (pts[0] as Point).value;
  const last = pts[pts.length - 1] as Point | undefined;
  if (last === undefined || phase >= last.at) return last === undefined ? base : last.value;

  const lo = locate(base === undefined ? track.ats : track.tailAts, phase);
  const b = pts[lo - o] as Point;
  const aAt = lo - 1 < o ? 0 : (pts[lo - 1 - o] as Point).at;
  const aValue = lo - 1 < o ? base : (pts[lo - 1 - o] as Point).value;
  const u = (phase - aAt) / (b.at - aAt);
  const eased = b.ease ? b.ease(u) : u;
  let value: unknown;
  if (into !== undefined) {
    value = into(reuse, aValue, b.value, eased);
    lastRead.wrote = value;
  } else {
    const by = track.lerp ?? lerp;
    value = by ? by(aValue as never, b.value as never, eased) : interpolate(aValue, b.value, eased);
  }
  // Leaving a retarget's base, bend the first segment so it starts at the slope the subject had:
  // add c·u(1−u)², which is 0 at both ends, flat at the end, and fixes the slope at the start.
  if (slope === undefined || lo - 1 >= o) return value;
  const len = b.at - aAt;
  const e0 = b.ease ? b.ease(1e-6) / 1e-6 : 1;
  const bend = (s: number, a: number, z: number) =>
    (s * period * len - (z - a) * e0) * u * (1 - u) * (1 - u);
  if (typeof value === 'number' && typeof slope === 'number')
    return value + bend(slope, aValue as number, b.value as number);
  if (Array.isArray(value) && Array.isArray(slope)) {
    const out = value === lastRead.wrote ? value : new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const s = slope[i];
      out[i] =
        typeof v === 'number' && typeof s === 'number'
          ? v + bend(s, (aValue as number[])[i] as number, (b.value as number[])[i] as number)
          : v;
    }
    return out;
  }
  return value;
}

/**
 * The first stop at or past `phase`, which ends the segment it falls in, for a phase strictly
 * between the first stop's and the last's.
 */
function locate(ats: Float64Array, phase: number): number {
  let lo = 1;
  let hi = ats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((ats[mid] as number) >= phase) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** A track's phase once its own delay is taken off, in a patch of `period` ms. */
function shift(delay: number, phase: number, period: number): number {
  return delay === 0 || period === 0 ? phase : Math.max(0, (phase * period - delay) / period);
}

/**
 * One track as numbers, `axes` to a stop with an absent axis read as `fill`, for a reader folding
 * a stock numeric channel without a delta: such a channel's `lerp` is `mix` on every axis.
 */
export interface Flat {
  track: Track;
  scalar: boolean;
  axes: number;
  fill: number;
  values: Float64Array;
}

const flats = new WeakMap<Track, Flat>();

/**
 * A built patch's one track as numbers for a stock numeric channel of `axes` axes, a number or an
 * array, or null where a read of it is not that: a `lerp` of its own, no stops, or a stop of
 * another shape than the channel's.
 */
export function flatOf(built: Built, scalar: boolean, axes: number, fill: number): Flat | null {
  const track = built.tracks[0];
  if (built.tracks.length !== 1 || track === undefined) return null;
  const known = flats.get(track);
  if (known !== undefined && known.scalar === scalar && known.axes === axes && known.fill === fill)
    return known;
  if (track.lerp !== undefined || track.all.length === 0) return null;
  const values = new Float64Array(track.all.length * axes);
  for (let p = 0; p < track.all.length; p++) {
    const v = (track.all[p] as Point).value;
    if (scalar) {
      if (typeof v !== 'number') return null;
      values[p] = v;
      continue;
    }
    if (!Array.isArray(v) && !ArrayBuffer.isView(v)) return null;
    const arr = v as ArrayLike<unknown>;
    for (let a = 0; a < axes; a++) {
      const x = arr[a] ?? fill;
      if (typeof x !== 'number') return null;
      values[p * axes + a] = x;
    }
  }
  const flat = { track, scalar, axes, fill, values };
  flats.set(track, flat);
  return flat;
}

/** Reads a flat track at `phase` into `out`, as `read` reads it through the channel's `lerp`. */
export function readFlat(f: Flat, phase: number, period: number, out: Float64Array): void {
  const track = f.track;
  const at = shift(track.delay, phase, period);
  const ats = track.ats;
  const n = ats.length;
  const axes = f.axes;
  const values = f.values;
  let from = 0;
  if (at <= (ats[0] as number)) from = 0;
  else if (at >= (ats[n - 1] as number)) from = n - 1;
  else {
    const lo = locate(ats, at);
    const aAt = ats[lo - 1] as number;
    const u = (at - aAt) / ((ats[lo] as number) - aAt);
    const ease = (track.all[lo] as Point).ease;
    const eased = ease ? ease(u) : u;
    const a0 = (lo - 1) * axes;
    const b0 = lo * axes;
    for (let a = 0; a < axes; a++)
      out[a] = mix(values[a0 + a] as number, values[b0 + a] as number, eased);
    return;
  }
  for (let a = 0; a < axes; a++) out[a] = values[from * axes + a] as number;
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
  const period = built.period;
  for (let i = 0; i < built.tracks.length; i++) {
    const track = built.tracks[i] as Track;
    const shifted = shift(track.delay, phase, period);
    const perMs = slopes?.[track.channel];
    const into = scratch === undefined ? undefined : intos?.[i];
    lastRead.wrote = undefined;
    const value = read(
      track,
      shifted,
      base?.[track.channel],
      lerps?.[i],
      period === 0 ? undefined : perMs,
      period,
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

const cache = new WeakMap<object, Built>();

/** The built form of a patch's stops, made on first ask for a patch `keys()` did not build. */
export function builtOf<I, O, S>(p: Patch<I, O, S>): Built {
  let held = cache.get(p);
  if (held === undefined) {
    held = build(p.keys as readonly Keyframe<O>[], p.writes, p.period, keysOptionsOf(p) ?? {});
    cache.set(p, held);
  }
  return held;
}

/** Evaluates a stop list into a fresh delta. */
export function evalKeys<O>(
  stops: readonly Keyframe<O>[],
  writes: readonly (keyof O)[],
  phase: number,
  period: number,
  opts: KeysOptions<O>,
  base?: Partial<O>,
): Partial<O> {
  return readKeys(build(stops, writes, period, opts), phase, {}, base as never) as Partial<O>;
}

/**
 * The declarative form. klieg's transition sugar and wod's keyframes.
 *
 * @category patch
 */
export function keys<I, O>(
  period: number,
  stops: readonly Keyframe<O>[],
  opts: KeysOptions<O> = {},
): Patch<I, O, void> {
  const writes = [...new Set(stops.flatMap((s) => Object.keys(s.delta) as (keyof O)[]))];
  const made = build(stops, writes, period, opts);
  const p: Patch<I, O, void> = {
    form: 'keys',
    period,
    writes,
    kit: opts.kit,
    keys: stops,
    at: (phase) => readKeys(made, phase, {}) as Partial<O>,
  };
  options.set(p as unknown as Patch<never, never, never>, opts as KeysOptions<unknown>);
  cache.set(p, made);
  return p;
}
