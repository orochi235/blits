import type { Channel, Kit } from './types.js';

/** The stock numeric channels' `lerp`, which every axis of a stock `vec` takes too. */
export const mix = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * Writes `lerp(a, b, u)` into `out` and returns it, or returns a new array where `out` is absent or
 * the wrong length. The caller must own `out`: nothing else may hold it.
 */
export type LerpInto = (out: unknown[] | undefined, a: unknown, b: unknown, u: number) => unknown[];

const inPlace = new WeakMap<object, LerpInto>();

/**
 * The in-place form of a stock array channel's `lerp`. Keyed by the channel rather than its `lerp`,
 * since only the stock fold and merge are known to copy the array rather than keep it.
 */
export function lerpInto(channel: Channel<unknown>): LerpInto | undefined {
  return inPlace.get(channel);
}

/** What a lane needs of a stock numeric channel beyond the channel: its arithmetic by name, its axes. */
export interface Numeric {
  op: 'sum' | 'mul' | 'max';
  axes: number;
}

/** The stock channels' arithmetic, once: their `merge` and `scale` are these, and so is `foldNumber`. */
const add = (a: number, b: number): number => a + b;
const times = (v: number, w: number): number => v * w;
const product = (a: number, b: number): number => a * b;
const toward = (v: number, w: number): number => 1 + (v - 1) * w;
const larger = (a: number, b: number): number => (a > b ? a : b);

const numerics = new WeakMap<object, Numeric>();

/**
 * The stock arithmetic of a channel `sum`, `mul`, `max` or `vec` made, keyed by the object itself,
 * so a custom channel that claims a stock `kind` is not trusted with a lane.
 */
export function numericOf(channel: Channel<unknown>): Numeric | undefined {
  return numerics.get(channel);
}

/** `merge(acc, scale(v, w))` for a stock numeric channel, in exactly its arithmetic. */
export function foldNumber(op: Numeric['op'], acc: number, v: number, w: number): number {
  if (op === 'sum') return add(acc, times(v, w));
  if (op === 'mul') return product(acc, toward(v, w));
  return larger(acc, times(v, w));
}

/**
 * What a stock numeric channel takes.
 *
 * @category channel
 */
export interface NumberOptions {
  /** The range the value means anything in; the mix clamps to it. */
  bounds?: readonly [min: number, max: number];
}

/** Bounds change how a value folds at its edges, so they are part of the kind. */
const kindOf = (name: string, bounds?: readonly [number, number]) =>
  bounds === undefined ? name : `${name}[${bounds[0]}, ${bounds[1]}]`;

/**
 * Position axes, rotation, crawl, yaw, pitch, offset.
 *
 * @category channel
 */
export function sum(opts?: NumberOptions): Channel<number> {
  const channel: Channel<number> = {
    kind: kindOf('sum', opts?.bounds),
    bounds: opts?.bounds,
    rest: 0,
    merge: add,
    scale: times,
    lerp: mix,
  };
  numerics.set(channel, { op: 'sum', axes: 1 });
  return channel;
}

/**
 * Gain, scale, opacity, hold.
 *
 * @category channel
 */
export function mul(opts?: NumberOptions): Channel<number> {
  const channel: Channel<number> = {
    kind: kindOf('mul', opts?.bounds),
    bounds: opts?.bounds,
    rest: 1,
    merge: product,
    scale: toward,
    lerp: mix,
  };
  numerics.set(channel, { op: 'mul', axes: 1 });
  return channel;
}

/**
 * Dark, aperture.
 *
 * @category channel
 */
export function max(opts?: NumberOptions): Channel<number> {
  const channel: Channel<number> = {
    kind: kindOf('max', opts?.bounds),
    bounds: opts?.bounds,
    rest: 0,
    merge: larger,
    scale: times,
    lerp: mix,
  };
  numerics.set(channel, { op: 'max', axes: 1 });
  return channel;
}

/**
 * A channel with no rest: the last influence to pass wins, and a weight can only gate it. The
 * default `lerp` steps at the midpoint, which is all a value with no arithmetic can promise; a
 * consumer with a real interpolation passes its own, as `hex` does.
 *
 * @category channel
 */
export function last<V>(opts?: { lerp?: (a: V, b: V, u: number) => V }): Channel<V> {
  return {
    // A lerp of its own is arithmetic the name cannot vouch for.
    kind: opts?.lerp ? undefined : 'last',
    merge: (_a, b) => b,
    lerp: opts?.lerp ?? ((a, b, u) => (u < 0.5 ? a : b)),
  };
}

/**
 * `n` copies of `v` in an array the engine stores as doubles from the start, so a copy of it, and
 * every fraction written into that copy, keeps one element kind: a pose's arrays then look alike to
 * every fold, whichever path made them.
 */
function doubles(n: number, v: number): number[] {
  if (n === 0) return [];
  const a = [0.5];
  for (let i = 1; i < n; i++) a.push(0.5);
  for (let i = 0; i < n; i++) a[i] = v;
  return a;
}

/**
 * Vec3 position, premultiplied light: one channel's arithmetic applied down an axis list.
 *
 * @category channel
 */
export function vec(n: number, of: Channel<number>): Channel<number[]> {
  const rest = of.rest === undefined ? undefined : doubles(n, of.rest);
  const scale = of.scale;
  const fill = of.rest ?? 0;
  const lerpTo = (out: number[] | undefined, a: number[], b: number[], u: number): number[] => {
    const o = out?.length === n ? out : new Array<number>(n);
    for (let i = 0; i < n; i++) o[i] = of.lerp(a[i] ?? fill, b[i] ?? fill, u);
    return o;
  };
  const channel: Channel<number[]> = {
    kind: of.kind === undefined ? undefined : `vec(${n}, ${of.kind})`,
    bounds: of.bounds,
    rest,
    merge: (a, b) => {
      const out = new Array<number>(n);
      for (let i = 0; i < n; i++) out[i] = of.merge(a[i] ?? fill, b[i] ?? fill);
      return out;
    },
    scale:
      scale === undefined
        ? undefined
        : (v, w) => {
            const out = new Array<number>(n);
            for (let i = 0; i < n; i++) out[i] = scale(v[i] ?? fill, w);
            return out;
          },
    fold:
      scale === undefined
        ? undefined
        : (into, v, w) => {
            for (let i = 0; i < n; i++) into[i] = of.merge(into[i] ?? fill, scale(v[i] ?? fill, w));
            return into;
          },
    lerp: (a, b, u) => lerpTo(undefined, a, b, u),
  };
  inPlace.set(channel, lerpTo as LerpInto);
  const inner = numerics.get(of);
  if (inner !== undefined && inner.axes === 1) numerics.set(channel, { ...inner, axes: n });
  return channel;
}

const LINEAR = Array.from({ length: 256 }, (_, c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** The linear value halfway between byte c - 1 and c: at or above it, a value rounds to c. */
const ROUNDS_UP = LINEAR.map((_, c) => {
  const v = (c - 0.5) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** The byte each 1/4096 of linear light starts at; a bin holds at most one rounding point. */
const BINS = 4096;
const FIRST = Array.from({ length: BINS + 1 }, (_, i) => {
  let c = 0;
  while (c < 255 && i / BINS >= (ROUNDS_UP[c + 1] as number)) c++;
  return c;
});

const toByte = (v: number): number => {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  const c = FIRST[(v * BINS) | 0] as number;
  return c < 255 && v >= (ROUNDS_UP[c + 1] as number) ? c + 1 : c;
};

/** Below this chroma a color is gray and its hue is noise, so the lerp takes the other end's. */
const GRAY = 1e-4;

/**
 * Colors already turned into OKLCH, direct-mapped on a byte of their hash: a mix reads the same
 * few keyframe colors every frame, and the table stays 256 colors however many it meets.
 */
const SLOTS = 256;
const slotColor = new Int32Array(SLOTS).fill(-1);
const slotL = new Float64Array(SLOTS);
const slotC = new Float64Array(SLOTS);
const slotH = new Float64Array(SLOTS);

/** 0xrrggbb to its slot, filled with [L, C, h], h in radians; Björn Ottosson's OKLab matrices. */
function oklch(rgb: number): number {
  const slot = Math.imul(rgb, 0x9e3779b1) >>> 24;
  if (slotColor[slot] === rgb) return slot;
  const r = LINEAR[(rgb >> 16) & 0xff] as number;
  const g = LINEAR[(rgb >> 8) & 0xff] as number;
  const b = LINEAR[rgb & 0xff] as number;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  slotColor[slot] = rgb;
  slotL[slot] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  slotC[slot] = Math.sqrt(A * A + B * B);
  slotH[slot] = Math.atan2(B, A);
  return slot;
}

/** [L, C, h] to 0xrrggbb, clipping each channel to sRGB's gamut. */
function fromOklch(L: number, C: number, h: number): number {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

/**
 * OKLCH, hue the short way round, so a crossfade between hues keeps its lightness and saturation
 * instead of dipping through a muddy middle. A mix that leaves sRGB's gamut is clipped per channel.
 *
 * @category channel
 */
export function mixHex(a: number, b: number, u: number): number {
  if (u === 0 || a === b) return a;
  if (u === 1) return b;
  const sa = oklch(a);
  const al = slotL[sa] as number;
  const ac = slotC[sa] as number;
  const ah = slotH[sa] as number;
  const sb = oklch(b);
  const bc = slotC[sb] as number;
  const from = ac < GRAY ? (slotH[sb] as number) : ah;
  const to = bc < GRAY ? ah : (slotH[sb] as number);
  let turn = to - from;
  if (turn > Math.PI) turn -= 2 * Math.PI;
  else if (turn < -Math.PI) turn += 2 * Math.PI;
  return fromOklch(mix(al, slotL[sb] as number, u), mix(ac, bc, u), from + turn * u);
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Each of red, green and blue on its own, as klieg's light channel blends. */
function mixSrgb(a: number, b: number, u: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (clamp255(mix(ar, br, u)) << 16) | (clamp255(mix(ag, bg, u)) << 8) | clamp255(mix(ab, bb, u))
  );
}

/**
 * Color, as 0xrrggbb, blended in OKLCH as `mixHex` does, or with `space: 'srgb'` channel by
 * channel in sRGB, which keeps a port's arithmetic identical to a host that blended that way.
 *
 * @category channel
 */
export function hex(opts?: { space?: 'oklch' | 'srgb' }): Channel<number> {
  return { ...last<number>({ lerp: opts?.space === 'srgb' ? mixSrgb : mixHex }), kind: 'hex' };
}

/**
 * A kit is plain data; this only fixes the type.
 *
 * @category channel
 */
export function kit<O>(channels: Kit<O>): Kit<O> {
  return channels;
}
