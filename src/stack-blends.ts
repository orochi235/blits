import { labOf, linearOf } from './oklab.js';

/**
 * The blend modes whose pose keeps every layer, in voice order, for `toHex` to lay over `under`
 * one by one: each mode whose result depends on the base nonlinearly, and the modes that blend a
 * whole color rather than each axis.
 *
 * @category channel
 */
export type OrderedMode =
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'difference'
  | 'colorDodge'
  | 'colorBurn'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'linearBurn'
  | 'vividLight'
  | 'linearLight'
  | 'pinLight'
  | 'hardMix'
  | 'hue'
  | 'saturation'
  | 'colorMode'
  | 'luminosity'
  | 'darkerColor'
  | 'lighterColor';

/**
 * A mode's blend of a layer over a base, both linear sRGB: per axis as `axis(b, s)`, or for a mode
 * that reads the whole color, `whole(base, s0, s1, s2)` writing the result into `base`. `css` is
 * its CSS `mix-blend-mode`, `normal` where CSS has none.
 */
export interface Stacked {
  tag: number;
  css: string;
  axis?: (b: number, s: number) => number;
  whole?: (base: number[], s0: number, s1: number, s2: number) => void;
}

const clip = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

const hard = (b: number, s: number): number => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s));

/** The W3C compositing spec's soft light. */
function soft(b: number, s: number): number {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

/** The W3C compositing spec's color dodge and color burn. */
const dodge = (b: number, s: number): number => (b <= 0 ? 0 : s >= 1 ? 1 : clip(b / (1 - s)));
const burn = (b: number, s: number): number => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - clip((1 - b) / s));
const vivid = (b: number, s: number): number => (s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1));

/** The base's lightness, then the layer's, in OKLab, with each one's a and b. */
const BASE = [0, 0, 0];
const LAYER = [0, 0, 0];
function labs(base: number[], s0: number, s1: number, s2: number): void {
  const b = labOf(base[0] as number, base[1] as number, base[2] as number);
  BASE[0] = b[0] as number;
  BASE[1] = b[1] as number;
  BASE[2] = b[2] as number;
  const l = labOf(s0, s1, s2);
  LAYER[0] = l[0] as number;
  LAYER[1] = l[1] as number;
  LAYER[2] = l[2] as number;
}

/** Writes OKLab `L, A, B` into `base` as linear sRGB, clipped to the gamut. */
function put(base: number[], L: number, A: number, B: number): void {
  const rgb = linearOf(L, A, B);
  base[0] = clip(rgb[0] as number);
  base[1] = clip(rgb[1] as number);
  base[2] = clip(rgb[2] as number);
}

/** A chroma below this has no hue to give: the color is gray. */
const GRAY = 1e-6;

/** `L` with the hue of `[hA, hB]` at the chroma of `[cA, cB]`, gray where either is gray. */
function hued(base: number[], L: number, hA: number, hB: number, cA: number, cB: number): void {
  const h = Math.hypot(hA, hB);
  const c = Math.hypot(cA, cB);
  if (h < GRAY || c < GRAY) put(base, L, 0, 0);
  else put(base, L, (hA * c) / h, (hB * c) / h);
}

/** The whole of whichever color, layer or base, `pick` takes by their OKLab lightness. */
const either =
  (pick: (layer: number, base: number) => boolean) =>
  (base: number[], s0: number, s1: number, s2: number): void => {
    labs(base, s0, s1, s2);
    if (!pick(LAYER[0] as number, BASE[0] as number)) return;
    base[0] = s0;
    base[1] = s1;
    base[2] = s2;
  };

export const STACKED: Record<OrderedMode, Stacked> = {
  overlay: { tag: -6, axis: (b, s) => hard(s, b), css: 'overlay' },
  softLight: { tag: -7, axis: soft, css: 'soft-light' },
  hardLight: { tag: -8, axis: hard, css: 'hard-light' },
  difference: { tag: -9, axis: (b, s) => (b > s ? b - s : s - b), css: 'difference' },
  colorDodge: { tag: -10, axis: dodge, css: 'color-dodge' },
  colorBurn: { tag: -11, axis: burn, css: 'color-burn' },
  exclusion: { tag: -12, axis: (b, s) => b + s - 2 * b * s, css: 'exclusion' },
  subtract: { tag: -13, axis: (b, s) => (b > s ? b - s : 0), css: 'normal' },
  divide: { tag: -14, axis: (b, s) => (b <= 0 ? 0 : s <= 0 ? 1 : clip(b / s)), css: 'normal' },
  linearBurn: { tag: -15, axis: (b, s) => clip(b + s - 1), css: 'normal' },
  vividLight: { tag: -16, axis: vivid, css: 'normal' },
  linearLight: { tag: -17, axis: (b, s) => clip(b + 2 * s - 1), css: 'normal' },
  pinLight: {
    tag: -18,
    axis: (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
    css: 'normal',
  },
  hardMix: { tag: -19, axis: (b, s) => (b + s >= 1 ? 1 : 0), css: 'normal' },
  hue: {
    tag: -20,
    whole: (base, s0, s1, s2) => {
      labs(base, s0, s1, s2);
      hued(
        base,
        BASE[0] as number,
        LAYER[1] as number,
        LAYER[2] as number,
        BASE[1] as number,
        BASE[2] as number,
      );
    },
    css: 'hue',
  },
  saturation: {
    tag: -21,
    whole: (base, s0, s1, s2) => {
      labs(base, s0, s1, s2);
      hued(
        base,
        BASE[0] as number,
        BASE[1] as number,
        BASE[2] as number,
        LAYER[1] as number,
        LAYER[2] as number,
      );
    },
    css: 'saturation',
  },
  colorMode: {
    tag: -22,
    whole: (base, s0, s1, s2) => {
      labs(base, s0, s1, s2);
      put(base, BASE[0] as number, LAYER[1] as number, LAYER[2] as number);
    },
    css: 'color',
  },
  luminosity: {
    tag: -23,
    whole: (base, s0, s1, s2) => {
      labs(base, s0, s1, s2);
      put(base, LAYER[0] as number, BASE[1] as number, BASE[2] as number);
    },
    css: 'luminosity',
  },
  darkerColor: { tag: -24, whole: either((l, b) => l < b), css: 'normal' },
  lighterColor: { tag: -25, whole: either((l, b) => l > b), css: 'normal' },
};

/** Each mode by its tag: tag `t` at `-6 - t`. */
export const BY_TAG: Stacked[] = Object.values(STACKED).sort((a, b) => b.tag - a.tag);

/** Whether `kind` names an ordered mode. */
export function ordered(kind: string): kind is OrderedMode {
  return Object.hasOwn(STACKED, kind);
}
