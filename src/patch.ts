import { type LerpInto, lerpInto } from './channels.js';
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
export interface Track {
  channel: string;
  /** Every stop carrying this channel, by phase. */
  all: Point[];
  /** The same without stops at 0, which a `from: 'current'` base replaces. */
  tail: Point[];
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
    tracks.push({
      channel: channel as string,
      all,
      tail: all.filter((pt) => pt.at !== 0),
      delay: opts.delayBy?.(channel) ?? 0,
      lerp: opts.lerpBy?.(channel) ?? (opts.kit?.[channel]?.lerp as Track['lerp']),
    });
  }
  return { tracks, period };
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
export function shifted(track: Track, phase: number, period: number): number {
  const delay = track.delay;
  return delay === 0 || period === 0 ? phase : Math.max(0, (phase * period - delay) / period);
}

/**
 * Finds where one track is at a phase, into `seg`: the one copy of the search, which `read` and a
 * lane folding stops straight into a subject's values both make. `base` stands in for the value at
 * phase 0, which is how `from: 'current'` starts a voice wherever the subject already is.
 */
export function segment(track: Track, phase: number, base: unknown): number {
  const pts = base === undefined ? track.all : track.tail;
  const o = base === undefined ? 0 : 1;
  const n = pts.length + o;
  if (n === 0) return NOTHING;
  const firstAt = o === 1 ? 0 : (pts[0] as Point).at;
  if (phase <= firstAt) {
    seg.a = o === 1 ? base : (pts[0] as Point).value;
    return AT;
  }
  const last = pts[pts.length - 1] as Point | undefined;
  if (last === undefined || phase >= last.at) {
    seg.a = last === undefined ? base : last.value;
    return AT;
  }

  // The first point at or past phase; the segment ends there.
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((pts[mid - o] as Point).at >= phase) hi = mid;
    else lo = mid + 1;
  }
  const b = pts[lo - o] as Point;
  const aAt = lo - 1 < o ? 0 : (pts[lo - 1 - o] as Point).at;
  const u = (phase - aAt) / (b.at - aAt);
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

/** Reads one track at a phase; `base` as `segment` takes it. */
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
  const e0 = ease ? ease(1e-6) / 1e-6 : 1;
  const bend = (s: number, a: number, z: number) =>
    (s * period * len - (z - a) * e0) * u * (1 - u) * (1 - u);
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
  const period = built.period;
  for (let i = 0; i < built.tracks.length; i++) {
    const track = built.tracks[i] as Track;
    const perMs = slopes?.[track.channel];
    const into = scratch === undefined ? undefined : intos?.[i];
    lastRead.wrote = undefined;
    const value = read(
      track,
      shifted(track, phase, period),
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
