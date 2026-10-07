import { last, lerpNumber } from './channels.js';
import type { Channel } from './types.js';

const mix = lerpNumber;

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

/** The last `lab` conversion's result, so the hot path allocates nothing. */
const LAB = [0, 0, 0];

/** 0xrrggbb to OKLab `[L, a, b]` in `LAB`; Björn Ottosson's OKLab matrices. */
function lab(rgb: number): void {
  const r = LINEAR[(rgb >> 16) & 0xff] as number;
  const g = LINEAR[(rgb >> 8) & 0xff] as number;
  const b = LINEAR[rgb & 0xff] as number;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  LAB[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  LAB[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  LAB[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** OKLab to 0xrrggbb, clipping each channel to sRGB's gamut. */
function fromLab(L: number, A: number, B: number): number {
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

/** 0xrrggbb to its slot, filled with [L, C, h], h in radians. */
function oklch(rgb: number): number {
  const slot = Math.imul(rgb, 0x9e3779b1) >>> 24;
  if (slotColor[slot] === rgb) return slot;
  lab(rgb);
  const A = LAB[1] as number;
  const B = LAB[2] as number;
  slotColor[slot] = rgb;
  slotL[slot] = LAB[0] as number;
  slotC[slot] = Math.sqrt(A * A + B * B);
  slotH[slot] = Math.atan2(B, A);
  return slot;
}

/** [L, C, h] to 0xrrggbb, clipping each channel to sRGB's gamut. */
function fromOklch(L: number, C: number, h: number): number {
  return fromLab(L, C * Math.cos(h), C * Math.sin(h));
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
