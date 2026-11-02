import { foldsInto, vouch } from './channels.js';
import { fromLinear, labOf, linearByte, linearOf } from './oklab.js';
import { BY_TAG, type OrderedMode, STACKED, type Stacked } from './stack-blends.js';
import type { Channel } from './types.js';
import { warnOnce } from './warn.js';

export type { OrderedMode } from './stack-blends.js';
export { ordered } from './stack-blends.js';

/**
 * What an ordered mode's rule takes.
 *
 * @category channel
 */
export interface StackOptions {
  /**
   * How many layers a subject's pose holds. Each voice laid on a subject takes one, a role one for
   * all its members; past this many, a layer is left off, with a warning outside production.
   * Default 4.
   */
  layers?: number;
}

const LAYERS = 4;

/** Each rule's layer count, where it was given one. */
const capacities = new WeakMap<object, number>();

/**
 * The mode a stack was folded by, or undefined for any other value. A stack is
 * `[tag, n, r, g, b, α, …]`: its mode's tag, how many layers it holds, then room for a fixed number
 * of layers, the first `n` laid in voice order, each linear sRGB with its opacity, and the rest at
 * opacity 0. No other color value starts with a negative number.
 */
function stackOf(pose: ArrayLike<number>): Stacked | undefined {
  const t = pose[0] ?? 0;
  return t < 0 && pose.length % 4 === 2 ? BY_TAG[-6 - t] : undefined;
}

const clip = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** An empty stack with room for `layers`, its mode `tag`. */
function empty(tag: number, layers: number): number[] {
  const out = [tag, 0];
  for (let i = 0; i < 4 * layers; i++) out.push(0);
  return out;
}

/** Lays one layer on top of `into`, or leaves it off where `into` is full. */
function push(into: number[], r: number, g: number, b: number, a: number, full: object): void {
  const n = into[1] as number;
  const at = 2 + 4 * n;
  if (at >= into.length) {
    warnOnce(
      full,
      `a stack of ${(into.length - 2) / 4} layers left one off; give the rule more, as overlay({ layers })`,
    );
    return;
  }
  into[1] = n + 1;
  into[at] = r;
  into[at + 1] = g;
  into[at + 2] = b;
  into[at + 3] = a;
}

/**
 * Lays `v` at weight `w` on top of the stack `into`. A stack's layers go on in their order, each
 * opacity times `w`; any other `v` is an OKLab contribution `[c·L, c·a, c·b, c]`, one layer at
 * opacity `w·c`, `c` capped at 1. A layer with no opacity is left off.
 */
function layOn(into: number[], v: ArrayLike<number>, w: number, full: object): number[] {
  if (!(w > 0)) return into;
  if (stackOf(v) !== undefined) {
    const end = 2 + 4 * (v[1] as number);
    for (let i = 2; i < end; i += 4) {
      const a = (v[i + 3] as number) * w;
      if (a > 0) push(into, v[i] as number, v[i + 1] as number, v[i + 2] as number, a, full);
    }
    return into;
  }
  const cov = v[3] ?? 0;
  if (!(cov > 0)) return into;
  const s = 1 / cov;
  const rgb = linearOf((v[0] ?? 0) * s, (v[1] ?? 0) * s, (v[2] ?? 0) * s);
  const r = clip(rgb[0] as number);
  const g = clip(rgb[1] as number);
  const b = clip(rgb[2] as number);
  push(into, r, g, b, w * (cov < 1 ? cov : 1), full);
  return into;
}

/**
 * A value as an OKLab contribution: a stack becomes its layers' average in OKLab, each weighted by
 * its opacity, at the coverage their opacities add up to, capped at 1. One layer is itself.
 */
function asColor(v: ArrayLike<number>): number[] {
  if (stackOf(v) === undefined) return v as number[];
  let L = 0;
  let A = 0;
  let B = 0;
  let total = 0;
  const end = 2 + 4 * (v[1] as number);
  for (let i = 2; i < end; i += 4) {
    const a = v[i + 3] as number;
    const lab = labOf(v[i] as number, v[i + 1] as number, v[i + 2] as number);
    L += a * (lab[0] as number);
    A += a * (lab[1] as number);
    B += a * (lab[2] as number);
    total += a;
  }
  if (!(total > 0)) return [0, 0, 0, 0];
  const k = (total < 1 ? total : 1) / total;
  return [L * k, A * k, B * k, total < 1 ? total : 1];
}

/**
 * A color channel stacking by an ordered mode, `rule` the one its author gave, a value traveling
 * between two colors by `lerp`. Its pose has room for the rule's layers, so it runs on lanes; a
 * travel's value is a stack of one layer, the colors at its ends traveled between.
 */
export function stacking(
  mode: OrderedMode,
  kind: string,
  lerp: Channel<number[]>['lerp'],
  rule: Channel<unknown>,
): Channel<number[]> {
  const tag = STACKED[mode].tag;
  const layers = capacities.get(rule) ?? LAYERS;
  const full = {};
  const lay = (into: number[], v: number[], w: number) => layOn(into, v, w, full);
  const channel: Channel<number[]> = {
    kind: layers === LAYERS ? kind : `${kind.slice(0, -1)}, ${layers})`,
    rest: empty(tag, layers),
    merge: (a, b) => lay(lay(empty(tag, layers), a, 1), b, 1),
    scale: (v, w) => lay(empty(tag, layers), v, w),
    fold: lay,
    lerp: (a, b, u) => {
      const v = u <= 0 ? asColor(a) : u >= 1 ? asColor(b) : lerp(asColor(a), asColor(b), u);
      return lay(empty(tag, layers), v, 1);
    },
  };
  vouch(channel, { op: 'own', axes: 2 + 4 * layers });
  foldsInto(channel);
  return channel;
}

const WHOLE = [0, 0, 0];

/** A stack laid over `under` as 0xrrggbb, bottom layer first, or undefined for any other pose. */
export function stackHex(pose: ArrayLike<number>, under: number): number | undefined {
  const m = stackOf(pose);
  if (m === undefined) return undefined;
  const end = 2 + 4 * (pose[1] as number);
  if (end === 2) return under;
  let r = linearByte((under >> 16) & 0xff);
  let g = linearByte((under >> 8) & 0xff);
  let b = linearByte(under & 0xff);
  const axis = m.axis;
  for (let i = 2; i < end; i += 4) {
    const a = pose[i + 3] as number;
    const s0 = pose[i] as number;
    const s1 = pose[i + 1] as number;
    const s2 = pose[i + 2] as number;
    if (axis !== undefined) {
      r += (axis(r, s0) - r) * a;
      g += (axis(g, s1) - g) * a;
      b += (axis(b, s2) - b) * a;
    } else {
      WHOLE[0] = r;
      WHOLE[1] = g;
      WHOLE[2] = b;
      (m.whole as NonNullable<Stacked['whole']>)(WHOLE, s0, s1, s2);
      r += ((WHOLE[0] as number) - r) * a;
      g += ((WHOLE[1] as number) - g) * a;
      b += ((WHOLE[2] as number) - b) * a;
    }
  }
  return fromLinear(r, g, b);
}

/**
 * A stack as a CSS `oklab()` color: its layers' average, their opacities summed and capped as the
 * alpha, so one layer is laid on by `mix-blend-mode` as `toHex` lays it. Undefined for any other
 * pose.
 */
export function stackCss(pose: ArrayLike<number>): string | undefined {
  if (stackOf(pose) === undefined) return undefined;
  const c = asColor(pose);
  const w = c[3] as number;
  if (!(w > 0)) return 'oklab(0 0 0 / 0)';
  return `oklab(${(c[0] as number) / w} ${(c[1] as number) / w} ${(c[2] as number) / w} / ${w})`;
}

/**
 * A stack's CSS `mix-blend-mode`, or undefined for any other pose. A mode CSS lacks gives `normal`,
 * with a warning once per mode outside production, since a page laying it by CSS draws it wrong.
 */
export function stackMode(pose: ArrayLike<number>): string | undefined {
  const s = stackOf(pose);
  if (s?.css === 'normal') {
    const name = Object.keys(STACKED).find((k) => STACKED[k as OrderedMode] === s);
    warnOnce(
      s,
      `CSS has no mix-blend-mode for ${name}(), so blendMode gives normal and a browser will not lay it as toHex does; draw it with toHex`,
    );
  }
  return s?.css;
}

/** A rule only a color channel takes, for `mode`: a number has no base to lay a layer over. */
export function rule(mode: OrderedMode, opts: StackOptions | undefined): Channel<number> {
  const refuse = (): never => {
    throw new Error(
      `${mode}() is a rule for color() or ink(), as color(${mode}()); a number has no base for it`,
    );
  };
  const channel: Channel<number> = { kind: mode, merge: refuse, scale: refuse, lerp: refuse };
  const layers = opts?.layers;
  if (layers !== undefined) {
    if (!(Number.isInteger(layers) && layers >= 1))
      throw new Error(`${mode}() takes a whole number of layers, at least 1, not ${layers}`);
    capacities.set(channel, layers);
  }
  return channel;
}
