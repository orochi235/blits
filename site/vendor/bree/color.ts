import { oklab, toHex } from '@msb235/blits';

/** The color of a lit dot nothing has tinted, unless a sign is given another. */
export const AMBER = 0xff9a2e;

/** 0xRRGGBB as r, g and b, 0..1. */
export const rgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

const hexCss = new Map<number, string>();
/** A 0xRRGGBB number as CSS `#rrggbb`, cached, since a frame asks for the same few each time. */
export function cssOf(hex: number): string {
  let s = hexCss.get(hex);
  if (s === undefined) {
    s = `#${hex.toString(16).padStart(6, '0')}`;
    hexCss.set(hex, s);
  }
  return s;
}

const pose = [0, 0, 0, 0];
const part = [0, 0, 0, 0];
let plainHex = Number.NaN;
let plain = [0, 0, 0, 0];

/** `hex` in OKLab, the last one asked for kept, since most dots share the message's color. */
function oklabOf(hex: number): number[] {
  if (hex !== plainHex) {
    plainHex = hex;
    plain = oklab(hex);
  }
  return plain;
}

/**
 * The hex a dot shows: its tint, the four values from `at` in `tint`, laid over `fallback` as far
 * as it covers the dot, with OKLab `a` and `b` turned by `hue` degrees and scaled by `chroma`.
 */
export function dotColor(
  tint: ArrayLike<number>,
  at: number,
  hue: number,
  chroma: number,
  fallback: number,
): number {
  const cover = tint[at + 3] ?? 0;
  let src: ArrayLike<number> = tint;
  if (!(cover >= 1)) {
    let under = fallback;
    if (cover > 0) {
      for (let k = 0; k < 4; k++) part[k] = tint[at + k] ?? 0;
      under = toHex(part, fallback);
    }
    if (hue === 0 && chroma === 1) return under;
    src = cover > 0 ? oklab(under) : oklabOf(under);
    at = 0;
  }
  const turn = (hue * Math.PI) / 180;
  const cos = Math.cos(turn) * chroma;
  const sin = Math.sin(turn) * chroma;
  const a = src[at + 1] ?? 0;
  const b = src[at + 2] ?? 0;
  pose[0] = src[at] ?? 0;
  pose[1] = a * cos - b * sin;
  pose[2] = a * sin + b * cos;
  pose[3] = src[at + 3] ?? 0;
  return toHex(pose);
}
