import type { Channel, Kit } from './types.js';

const mix = (a: number, b: number, u: number) => a + (b - a) * u;

/** Position axes, rotation, crawl, yaw, pitch, offset. */
export function sum(): Channel<number> {
  return {
    rest: 0,
    merge: (a, b) => a + b,
    scale: (v, w) => v * w,
    lerp: mix,
  };
}

/** Gain, scale, opacity, hold. */
export function mul(): Channel<number> {
  return {
    rest: 1,
    merge: (a, b) => a * b,
    scale: (v, w) => 1 + (v - 1) * w,
    lerp: mix,
  };
}

/** Dark, aperture. */
export function max(): Channel<number> {
  return {
    rest: 0,
    merge: (a, b) => (a > b ? a : b),
    scale: (v, w) => v * w,
    lerp: mix,
  };
}

/**
 * A channel with no rest: the last influence to pass wins, and a weight can only gate it. The
 * default `lerp` steps at the midpoint, which is all a value with no arithmetic can promise; a
 * consumer with a real interpolation passes its own, as `hex` does.
 */
export function last<V>(opts?: { lerp?: (a: V, b: V, u: number) => V }): Channel<V> {
  return {
    merge: (_a, b) => b,
    lerp: opts?.lerp ?? ((a, b, u) => (u < 0.5 ? a : b)),
  };
}

/** Vec3 position, premultiplied light: one channel's arithmetic applied down an axis list. */
export function vec(n: number, of: Channel<number>): Channel<number[]> {
  const rest = of.rest === undefined ? undefined : new Array<number>(n).fill(of.rest);
  const scale = of.scale;
  const fill = of.rest ?? 0;
  return {
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
    lerp: (a, b, u) => {
      const out = new Array<number>(n);
      for (let i = 0; i < n; i++) out[i] = of.lerp(a[i] ?? fill, b[i] ?? fill, u);
      return out;
    },
  };
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * sRGB, which is what klieg's light channel already assumes, so the port's arithmetic is
 * unchanged. OKLCH reads better across hues and is the open question, not a second function.
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

/** Color, as 0xrrggbb. */
export function hex(): Channel<number> {
  return last<number>({ lerp: mixHex });
}

/** A kit is plain data; this only fixes the type. */
export function kit<O>(channels: Kit<O>): Kit<O> {
  return channels;
}
