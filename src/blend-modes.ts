import { doubles, lerpNumber, max, mul, sum, vouch } from './channels.js';
import { fromLinear, labOf, linearByte, linearOf } from './oklab.js';
import type { Channel } from './types.js';

/**
 * How a color channel's voices lay over what is under them, in linear sRGB.
 *
 * @category channel
 */
export type BlendMode = 'multiply' | 'screen' | 'add' | 'lighten' | 'darken';

/**
 * A mode's fold. Each voice's layer becomes, per axis, `x = α·c`, or `α·(1 - c)` where `invert`,
 * α its opacity; the pose folds every `x` by `op`, starting from 0, and the layer it stands for is
 * the pose, or `1 - pose` where `invert`. The pose's fourth number is `tag`.
 */
interface Mode {
  tag: number;
  invert: boolean;
  op: 'screen' | 'sum' | 'max';
  /** The CSS `mix-blend-mode` that lays the layer over what is under it. */
  css: string;
}

const MODES: Record<BlendMode, Mode> = {
  multiply: { tag: -1, invert: true, op: 'screen', css: 'multiply' },
  screen: { tag: -2, invert: false, op: 'screen', css: 'screen' },
  add: { tag: -3, invert: false, op: 'sum', css: 'plus-lighter' },
  lighten: { tag: -4, invert: false, op: 'max', css: 'lighten' },
  darken: { tag: -5, invert: true, op: 'max', css: 'darken' },
};
const BY_TAG = [undefined, MODES.multiply, MODES.screen, MODES.add, MODES.lighten, MODES.darken];

/** The mode a merge rule names, if it names one. */
export function modeOf(of: Channel<unknown>): BlendMode | undefined {
  const kind = of.kind;
  return kind !== undefined && Object.hasOwn(MODES, kind) ? (kind as BlendMode) : undefined;
}

/** The mode a pose was folded by, or undefined for any other pose. */
function tagged(pose: ArrayLike<number>): Mode | undefined {
  return pose.length === 4 ? BY_TAG[-(pose[3] ?? 0)] : undefined;
}

const clip = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const toward = (v: number, w: number): number => 1 + (v - 1) * w;
const screened = (a: number, b: number): number => a + b - a * b;

/**
 * A number laid over another by multiply: contributions multiply, resting at 1, and a weight is a
 * layer's opacity, fading it toward 1. In `color(multiply())`, light through stacked filters.
 *
 * @category channel
 */
export function multiply(): Channel<number> {
  const channel: Channel<number> = { ...mul(), kind: 'multiply' };
  vouch(channel, { op: 'mul', axes: 1 });
  return channel;
}

/**
 * A number laid over another by screen, `a + b - a·b`, resting at 0; a weight is a layer's
 * opacity. In `color(screen())`, stacked projectors: it only lightens, and never past white.
 *
 * @category channel
 */
export function screen(): Channel<number> {
  return { kind: 'screen', rest: 0, merge: screened, scale: (v, w) => v * w, lerp: lerpNumber };
}

/**
 * Numbers that add, resting at 0, a weight a layer's opacity. In `color(add())`, light added to
 * light, clipped at white; `color()` itself averages instead.
 *
 * @category channel
 */
export function add(): Channel<number> {
  const channel: Channel<number> = { ...sum(), kind: 'add' };
  vouch(channel, { op: 'sum', axes: 1 });
  return channel;
}

/**
 * The largest number wins, resting at 0, a weight scaling a layer toward 0 first. In
 * `color(lighten())`, each axis takes its lightest layer.
 *
 * @category channel
 */
export function lighten(): Channel<number> {
  const channel: Channel<number> = { ...max(), kind: 'lighten' };
  vouch(channel, { op: 'max', axes: 1 });
  return channel;
}

/**
 * The smallest number wins, resting at 1, a weight fading a layer toward 1 first. In
 * `color(darken())`, each axis takes its darkest layer.
 *
 * @category channel
 */
export function darken(): Channel<number> {
  return {
    kind: 'darken',
    rest: 1,
    merge: (a, b) => (a < b ? a : b),
    scale: toward,
    lerp: lerpNumber,
  };
}

/**
 * Folds `v` at weight `w` into the pose `into`. A tagged `v` is a pose, the one layer its voices
 * add up to at full opacity; any other is an OKLab contribution `[w·L, w·a, w·b, w]`.
 */
function foldInto(m: Mode, into: number[], v: ArrayLike<number>, w: number): number[] {
  let x0: number;
  let x1: number;
  let x2: number;
  if (tagged(v) !== undefined) {
    x0 = (v[0] as number) * w;
    x1 = (v[1] as number) * w;
    x2 = (v[2] as number) * w;
  } else {
    const cov = v[3] ?? 0;
    if (!(cov > 0 && w > 0)) {
      into[3] = m.tag;
      return into;
    }
    const s = 1 / cov;
    const rgb = linearOf((v[0] ?? 0) * s, (v[1] ?? 0) * s, (v[2] ?? 0) * s);
    const a = w * (cov < 1 ? cov : 1);
    const r = clip(rgb[0] as number);
    const g = clip(rgb[1] as number);
    const b = clip(rgb[2] as number);
    x0 = a * (m.invert ? 1 - r : r);
    x1 = a * (m.invert ? 1 - g : g);
    x2 = a * (m.invert ? 1 - b : b);
  }
  const p0 = into[0] ?? 0;
  const p1 = into[1] ?? 0;
  const p2 = into[2] ?? 0;
  if (m.op === 'screen') {
    into[0] = screened(p0, x0);
    into[1] = screened(p1, x1);
    into[2] = screened(p2, x2);
  } else if (m.op === 'sum') {
    into[0] = p0 + x0;
    into[1] = p1 + x1;
    into[2] = p2 + x2;
  } else {
    into[0] = p0 > x0 ? p0 : x0;
    into[1] = p1 > x1 ? p1 : x1;
    into[2] = p2 > x2 ? p2 : x2;
  }
  into[3] = m.tag;
  return into;
}

/** A value as an OKLab contribution: a pose becomes its one layer at full coverage. */
function asColor(v: number[]): number[] {
  const m = tagged(v);
  if (m === undefined) return v;
  const layer = (i: number) => (m.invert ? 1 - (v[i] as number) : (v[i] as number));
  const lab = labOf(layer(0), layer(1), layer(2));
  return [lab[0] as number, lab[1] as number, lab[2] as number, 1];
}

/**
 * A color channel folding by `mode`, a value traveling between two colors by `lerp`. Its pose is
 * `[x, y, z, tag]`: the layer its voices add up to, in the mode's terms, and the mode's tag, so
 * `toHex` and `css` can read it without the channel.
 */
export function blending(
  mode: BlendMode,
  kind: string,
  lerp: Channel<number[]>['lerp'],
): Channel<number[]> {
  const m = MODES[mode];
  const channel: Channel<number[]> = {
    kind,
    rest: doubles(4, 0),
    merge: (a, b) => foldInto(m, foldInto(m, doubles(4, 0), a, 1), b, 1),
    scale: (v, w) => foldInto(m, doubles(4, 0), v, w),
    fold: (into, v, w) => foldInto(m, into, v, w),
    lerp: (a, b, u) => lerp(asColor(a), asColor(b), u),
  };
  vouch(channel, { op: 'own', axes: 4 });
  return channel;
}

/** The linear value of byte `shift` of `under`, laid under the pose's layer on that axis. */
function axis(m: Mode, p: number, under: number, shift: number): number {
  const u = linearByte((under >> shift) & 0xff);
  const l = m.invert ? 1 - p : p;
  if (m.op === 'sum') return u + l;
  if (m === MODES.multiply) return u * l;
  if (m === MODES.screen) return screened(u, l);
  if (m === MODES.lighten) return u > l ? u : l;
  return u < l ? u : l;
}

/** A blend pose laid over `under` as 0xrrggbb, or undefined for any other pose. */
export function blendHex(pose: ArrayLike<number>, under: number): number | undefined {
  const m = tagged(pose);
  if (m === undefined) return undefined;
  return fromLinear(
    axis(m, pose[0] as number, under, 16),
    axis(m, pose[1] as number, under, 8),
    axis(m, pose[2] as number, under, 0),
  );
}

/** A blend pose's one layer as an opaque CSS `oklab()` color, or undefined for any other pose. */
export function blendCss(pose: ArrayLike<number>): string | undefined {
  const m = tagged(pose);
  if (m === undefined) return undefined;
  const lab = asColor(Array.from(pose));
  return `oklab(${lab[0]} ${lab[1]} ${lab[2]})`;
}

/**
 * The CSS `mix-blend-mode` that lays `css(pose)` over what is under it as `toHex` does: a blend
 * mode's own, `plus-lighter` for `add`, and `normal` for any other color. Browsers blend in
 * gamma-encoded sRGB, not the linear light `toHex` uses, so the two differ in the midtones.
 *
 * @category channel
 */
export function blendMode(pose: ArrayLike<number>): string {
  return tagged(pose)?.css ?? 'normal';
}
