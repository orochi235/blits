import { doubles, lerpNumber, numericOf, sum, vec, vouch, widen } from './channels.js';
import { HUES, lchPair, shortWay } from './lch.js';
import type { Channel } from './types.js';
import { warnOnce } from './warn.js';

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
 * Crossfades two hex colors in OKLCH, hue the short way round. A crossfade between hues then keeps
 * its lightness and saturation instead of dipping through a muddy middle. A mix that leaves sRGB's
 * gamut is clipped per channel.
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
  const h = hueAt(ah, ac, slotH[sb] as number, bc, u);
  return fromOklch(mix(al, slotL[sb] as number, u), mix(ac, bc, u), h);
}

/** The hue `u` of the way from `ah` to `bh` the short way round, a gray end taking the other's. */
function hueAt(ah: number, ac: number, bh: number, bc: number, u: number): number {
  shortWay(ah, ac, bh, bc);
  return (HUES[0] as number) + (HUES[1] as number) * u;
}

/**
 * What `color` took before `ink` existed: `lerp: 'oklch'` overlaps straight across OKLab and
 * travels round the hue.
 *
 * @category channel
 */
export interface ColorOptions {
  /** @deprecated `'oklch'` is `ink()`, which also blends overlapping voices round the hue; `'oklab'` is `color()`. */
  lerp?: 'oklab' | 'oklch';
}

const LERP = {};

const PAIR = new Float64Array(8);

/** Two OKLab colors with coverage, interpolated in OKLCH: color by `u`, coverage by `u` alongside. */
function lerpLch(x: number[], y: number[], u: number): number[] {
  const p = PAIR;
  lchPair(x, 0, y, 0, p);
  const w = mix(p[3] as number, p[7] as number, u);
  const C = mix(p[1] as number, p[5] as number, u);
  const h = (p[2] as number) + (HUES[1] as number) * u;
  return [mix(p[0] as number, p[4] as number, u) * w, C * Math.cos(h) * w, C * Math.sin(h) * w, w];
}

/** Below this, an ink pose's summed `(a, b)` has canceled out and shows no hue. */
const CANCEL = 1e-9;

/**
 * A color value, `oklab()`'s four numbers or ink's five, into `out` at `o` as `[L, C, h, w]`, its
 * coverage divided out. Five numbers show their own chroma, the fourth, at the hue of their `(a, b)`.
 */
function lchOf(v: ArrayLike<number>, out: Float64Array, o: number): void {
  const five = v.length > 4;
  const w = (five ? v[4] : v[3]) ?? 0;
  const s = w > 0 ? 1 / w : 0;
  const a = (v[1] ?? 0) * s;
  const b = (v[2] ?? 0) * s;
  const r = Math.sqrt(a * a + b * b);
  out[o] = (v[0] ?? 0) * s;
  out[o + 1] = !five ? r : r < CANCEL ? 0 : (v[3] ?? 0) * s;
  out[o + 2] = Math.atan2(b, a);
  out[o + 3] = w;
}

/** A color value as ink's five numbers, `[w·L, w·a, w·b, w·C, w]` times `k`, into `out`. */
function inked(v: ArrayLike<number>, k: number, out: number[]): number[] {
  const a = v[1] ?? 0;
  const b = v[2] ?? 0;
  const five = v.length > 4;
  out[0] = (v[0] ?? 0) * k;
  out[1] = a * k;
  out[2] = b * k;
  out[3] = (five ? (v[3] ?? 0) : Math.sqrt(a * a + b * b)) * k;
  out[4] = ((five ? v[4] : v[3]) ?? 0) * k;
  return out;
}

/** Two colors, four numbers or five, interpolated round the hue into ink's five. */
function lerpInk(x: number[], y: number[], u: number): number[] {
  if (u === 0) return inked(x, 1, doubles(5, 0));
  if (u === 1) return inked(y, 1, doubles(5, 0));
  const p = PAIR;
  lchOf(x, p, 0);
  lchOf(y, p, 4);
  // A color with no coverage has none of its own to keep, so it takes the other end's.
  const from = (p[3] as number) > 0 ? 0 : 4;
  const to = (p[7] as number) > 0 ? 4 : 0;
  const xc = p[from + 1] as number;
  const yc = p[to + 1] as number;
  shortWay(p[from + 2] as number, xc, p[to + 2] as number, yc);
  const w = mix(p[3] as number, p[7] as number, u);
  const Cw = mix(xc, yc, u) * w;
  const h = (HUES[0] as number) + (HUES[1] as number) * u;
  return [
    mix(p[from] as number, p[to] as number, u) * w,
    Math.cos(h) * Cw,
    Math.sin(h) * Cw,
    Cw,
    w,
  ];
}

/**
 * Whether `channel` travels round the hue, as `ink` does, so a motion patch cued on it moves round
 * the hue too.
 */
export function roundsHue(channel: Channel<unknown>): boolean {
  const lerp = channel.lerp as unknown;
  return lerp === lerpLch || lerp === lerpInk;
}

/** Whether `of` asks a color channel to average: absent, or a stock `sum` with no turn or bounds. */
function averages(of: Channel<unknown> | undefined): boolean {
  if (of === undefined) return true;
  const stock = numericOf(of);
  return stock?.op === 'sum' && stock.turn === undefined && of.bounds === undefined;
}

const refuse = (name: string, of: Channel<unknown>) =>
  new Error(
    `${name} takes sum() to average or last() to replace, not ${of.kind ?? 'a channel of its own'}`,
  );

/** A `last` color channel, which replaces and travels by `lerp`. */
function replacing(kind: string, lerp: Channel<number[]>['lerp']): Channel<number[]> {
  const channel: Channel<number[]> = { kind, merge: (_a, b) => b, lerp };
  widen(channel, 4);
  vouch(channel, { op: 'last', axes: 4 });
  return channel;
}

/**
 * Color as the real world shows it, light, sky, smoke or paint: OKLab `[L, a, b, coverage]`, its
 * merge rule given as `of`. `color()` averages: voices stack as a premultiplied sum, so a pose
 * holds `[Σw·L, Σw·a, Σw·b, Σw]` and runs on lanes; `toHex` divides it out and lays it over what
 * is under it. `color(last())` replaces, the last voice to pass winning, at the coverage it was
 * authored with. It travels between two colors, in a motion or a role's handoff, straight across
 * OKLab, so opposite hues cross through gray. For colors that stand for a meaning, use `ink`.
 *
 * @category channel
 */
export function color(opts?: ColorOptions): Channel<number[]>;
export function color(
  of: Channel<number> | Channel<unknown>,
  opts?: ColorOptions,
): Channel<number[]>;
export function color(
  ofOrOpts?: Channel<number> | Channel<unknown> | ColorOptions,
  maybe?: ColorOptions,
): Channel<number[]> {
  const of = ofOrOpts !== undefined && 'merge' in ofOrOpts ? ofOrOpts : undefined;
  const opts = of === undefined ? (ofOrOpts as ColorOptions | undefined) : maybe;
  if (opts?.lerp !== undefined)
    warnOnce(
      LERP,
      "color({ lerp }) is deprecated: 'oklch' is ink(), which also blends overlapping voices round the hue, and 'oklab' is color()",
    );
  const round = opts?.lerp === 'oklch';
  const space = round ? ', oklch' : '';
  if (averages(of as Channel<unknown> | undefined)) {
    const channel = vec(4, sum());
    channel.kind = `color(sum${space})`;
    if (!round) return channel;
    const turning: Channel<number[]> = { ...channel, lerp: lerpLch };
    vouch(turning, { op: 'own', axes: 4, folds: 'sum' });
    return turning;
  }
  const own = of as Channel<unknown>;
  if (own.kind === 'last')
    return replacing(`color(last${space})`, round ? lerpLch : vec(4, sum()).lerp);
  throw refuse('color', own);
}

/** Where `ink`'s merge and fold widen a contribution, which neither keeps. */
const WIDE = doubles(5, 0);

/**
 * Color standing for a meaning, a status, a level or a team, rather than for a physical
 * phenomenon: choose it over `color` when the colors are symbols. People picture the midpoint
 * between red and blue as purple, reached by turning the hue, not as the grayed mix light makes,
 * and `ink` gives them that. It travels round the hue the short way, in a motion, between keys
 * and in a role's handoff, and `ink()` blends overlapping voices round the hue too: each voice
 * sums as `[w·L, w·a, w·b, w·C, w]`, C its chroma, so a pose shows lightness `ΣwL/Σw`, the hue of
 * `Σw·(a, b)`, which a gray voice pulls on not at all, and chroma `ΣwC/Σw`, so two vivid colors
 * stay vivid. Near-opposite hues overlapping swing round the wheel as their weights cross, with
 * no tiebreak, and exactly opposite ones cancel to gray. A patch writes it the `oklab()` values a
 * `color` takes, and `toHex` and `css` read either. `ink(last())` replaces, traveling round the
 * hue, and holds the four numbers it was written, since it never sums.
 *
 * @category channel
 */
export function ink(of?: Channel<number> | Channel<unknown>): Channel<number[]> {
  if (!averages(of as Channel<unknown> | undefined)) {
    const own = of as Channel<unknown>;
    if (own.kind === 'last') return replacing('ink(last)', lerpLch);
    throw refuse('ink', own);
  }
  const channel: Channel<number[]> = {
    kind: 'ink(sum)',
    rest: doubles(5, 0),
    merge: (x, y) => {
      const out = inked(x, 1, doubles(5, 0));
      const add = inked(y, 1, WIDE);
      for (let i = 0; i < 5; i++) out[i] = (out[i] as number) + (add[i] as number);
      return out;
    },
    scale: (v, w) => inked(v, w, doubles(5, 0)),
    fold: (into, v, w) => {
      const add = inked(v, w, WIDE);
      for (let i = 0; i < 5; i++) into[i] = (into[i] ?? 0) + (add[i] as number);
      return into;
    },
    lerp: lerpInk,
  };
  vouch(channel, { op: 'own', axes: 5 });
  return channel;
}

/**
 * Converts 0xrrggbb to a `color` or `ink` value. The value is OKLab `[L, a, b]` at full coverage. Convert
 * keyframe stops once when authoring them, and call it outside the hot path in an `fn` patch.
 *
 * @category channel
 */
export function oklab(rgb: number): number[] {
  lab(rgb);
  return [LAB[0] as number, LAB[1] as number, LAB[2] as number, 1];
}

/** The color the last `shows` call read, `[L, a, b]` with its coverage divided out. */
const SHOWN = [0, 0, 0];

/**
 * A `color` pose's or an `ink` pose's color into `SHOWN`, returning its coverage. Ink's shows the
 * hue of its `(a, b)` at the chroma its fourth number holds, and gray where `(a, b)` cancels.
 */
function shows(pose: ArrayLike<number>): number {
  if (pose.length <= 4) {
    const w = pose[3] ?? 0;
    if (!(w > 0)) return w;
    const s = 1 / w;
    SHOWN[0] = (pose[0] ?? 0) * s;
    SHOWN[1] = (pose[1] ?? 0) * s;
    SHOWN[2] = (pose[2] ?? 0) * s;
    return w;
  }
  const w = pose[4] ?? 0;
  if (!(w > 0)) return w;
  const s = 1 / w;
  const a = (pose[1] ?? 0) * s;
  const b = (pose[2] ?? 0) * s;
  const r = Math.sqrt(a * a + b * b);
  const k = r < CANCEL ? 0 : ((pose[3] ?? 0) * s) / r;
  SHOWN[0] = (pose[0] ?? 0) * s;
  SHOWN[1] = a * k;
  SHOWN[2] = b * k;
  return w;
}

/**
 * A `color` or `ink` pose as 0xrrggbb, laid over `under`. Its color is divided out of its
 * coverage, the coverage capped at 1 and laid over `under` in OKLab, then clipped to sRGB per
 * channel. No coverage gives `under`.
 *
 * @category channel
 */
export function toHex(pose: ArrayLike<number>, under = 0x000000): number {
  const w = shows(pose);
  if (!(w > 0)) return under;
  const L = SHOWN[0] as number;
  const A = SHOWN[1] as number;
  const B = SHOWN[2] as number;
  if (w >= 1) return fromLab(L, A, B);
  lab(under);
  return fromLab(
    mix(LAB[0] as number, L, w),
    mix(LAB[1] as number, A, w),
    mix(LAB[2] as number, B, w),
  );
}

/**
 * A `color` or `ink` pose as a CSS `oklab()` color, its coverage as the alpha. The coverage is
 * capped at 1. For a host that lets the browser lay it over what is under it.
 *
 * @category channel
 */
export function css(pose: ArrayLike<number>): string {
  const w = shows(pose);
  if (!(w > 0)) return 'oklab(0 0 0 / 0)';
  return `oklab(${SHOWN[0]} ${SHOWN[1]} ${SHOWN[2]} / ${w < 1 ? w : 1})`;
}
