import { clampWeight } from './clock.js';

/** sRGB bytes, linear sRGB and OKLab, one to another. */

const decode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

const LINEAR = Array.from({ length: 256 }, (_, c) => decode(c / 255));

/** The linear value halfway between byte c - 1 and c: at or above it, a value rounds to c. */
const ROUNDS_UP = LINEAR.map((_, c) => decode((c - 0.5) / 255));

/** The byte each 1/4096 of linear light starts at; a bin holds at most one rounding point. */
const BINS = 4096;
const FIRST = Array.from({ length: BINS + 1 }, (_, i) => {
  let c = 0;
  while (c < 255 && i / BINS >= (ROUNDS_UP[c + 1] as number)) c++;
  return c;
});

export const toByte = (v: number): number => {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  const c = FIRST[(v * BINS) | 0] as number;
  return c < 255 && v >= (ROUNDS_UP[c + 1] as number) ? c + 1 : c;
};

/** `v` held to [0, 1], as a linear RGB axis is before it becomes a byte. */
export const clip = clampWeight;

/** The last `lab` conversion's result, so the hot path allocates nothing. */
export const LAB = [0, 0, 0];

/** 0xrrggbb to OKLab `[L, a, b]` in `LAB`. */
export function lab(rgb: number): void {
  labOf(
    LINEAR[(rgb >> 16) & 0xff] as number,
    LINEAR[(rgb >> 8) & 0xff] as number,
    LINEAR[rgb & 0xff] as number,
  );
}

/** Linear sRGB to OKLab `[L, a, b]` in `LAB`; Björn Ottosson's OKLab matrices. */
export function labOf(r: number, g: number, b: number): number[] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  LAB[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  LAB[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  LAB[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return LAB;
}

/** The last `linearOf` conversion's result. */
const RGB = [0, 0, 0];

/** OKLab to linear sRGB `[r, g, b]` in `RGB`, unclipped. */
export function linearOf(L: number, A: number, B: number): number[] {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  RGB[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  RGB[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  RGB[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return RGB;
}

/**
 * A premultiplied OKLab contribution `[c·L, c·a, c·b]` at coverage `cov` > 0 into `RGB` as linear
 * sRGB, each axis clipped to [0, 1].
 */
export function clippedOf(v: ArrayLike<number>, cov: number): number[] {
  const s = 1 / cov;
  const rgb = linearOf((v[0] ?? 0) * s, (v[1] ?? 0) * s, (v[2] ?? 0) * s);
  rgb[0] = clip(rgb[0] as number);
  rgb[1] = clip(rgb[1] as number);
  rgb[2] = clip(rgb[2] as number);
  return rgb;
}

/** 0xrrggbb to linear sRGB, one channel: `LINEAR[byte]`. */
export const linearByte = (byte: number): number => LINEAR[byte] as number;

/** OKLab to 0xrrggbb, clipping each channel to sRGB's gamut. */
export function fromLab(L: number, A: number, B: number): number {
  const rgb = linearOf(L, A, B);
  return fromLinear(rgb[0] as number, rgb[1] as number, rgb[2] as number);
}

/** Linear sRGB to 0xrrggbb, clipping each channel. */
export function fromLinear(r: number, g: number, b: number): number {
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}
