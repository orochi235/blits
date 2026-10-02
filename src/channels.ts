import type { Channel, Kit } from './types.js';

const mix = (a: number, b: number, u: number) => a + (b - a) * u;

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

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * sRGB, which is what klieg's light channel already assumes, so the port's arithmetic is
 * unchanged. OKLCH reads better across hues and is the open question, not a second function.
 *
 * @category channel
 */
export function mixHex(a: number, b: number, u: number): number {
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
 * Color, as 0xrrggbb.
 *
 * @category channel
 */
export function hex(): Channel<number> {
  return { ...last<number>({ lerp: mixHex }), kind: 'hex' };
}

/**
 * A kit is plain data; this only fixes the type.
 *
 * @category channel
 */
export function kit<O>(channels: Kit<O>): Kit<O> {
  return channels;
}
