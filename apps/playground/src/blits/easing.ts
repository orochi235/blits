import type { Easing } from '@msb235/blits';
import type { EasingSpec } from '@weasel-js/core';
import { easingBezier } from '@weasel-js/ui';

type Bezier = readonly [number, number, number, number];
type Named = Exclude<Easing, object | ((u: number) => number)>;

export const CSS: Record<Exclude<Named, 'linear'>, Bezier> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

// easings.net's cubic-bezier forms; bounce and elastic have none, so blits cannot keep them as data.
const WEASEL: Record<string, Bezier> = {
  easeInSine: [0.12, 0, 0.39, 0],
  easeOutSine: [0.61, 1, 0.88, 1],
  easeInOutSine: [0.37, 0, 0.63, 1],
  easeInQuad: [0.11, 0, 0.5, 0],
  easeOutQuad: [0.5, 1, 0.89, 1],
  easeInOutQuad: [0.45, 0, 0.55, 1],
  easeInCubic: [0.32, 0, 0.67, 0],
  easeOutCubic: [0.33, 1, 0.68, 1],
  easeInOutCubic: [0.65, 0, 0.35, 1],
  easeInQuart: [0.5, 0, 0.75, 0],
  easeOutQuart: [0.25, 1, 0.5, 1],
  easeInOutQuart: [0.76, 0, 0.24, 1],
  easeInQuint: [0.64, 0, 0.78, 0],
  easeOutQuint: [0.22, 1, 0.36, 1],
  easeInOutQuint: [0.83, 0, 0.17, 1],
  easeInExpo: [0.7, 0, 0.84, 0],
  easeOutExpo: [0.16, 1, 0.3, 1],
  easeInOutExpo: [0.87, 0, 0.13, 1],
  easeInCirc: [0.55, 0, 1, 0.45],
  easeOutCirc: [0, 0.55, 0.45, 1],
  easeInOutCirc: [0.85, 0, 0.15, 1],
  easeInBack: [0.36, 0, 0.66, -0.56],
  easeOutBack: [0.34, 1.56, 0.64, 1],
  easeInOutBack: [0.68, -0.6, 0.32, 1.6],
};

const same = (a: readonly number[], b: readonly number[]) => a.every((x, i) => x === b[i]);
const nameOf = <K extends string>(table: Record<K, Bezier>, b: readonly number[]) =>
  (Object.keys(table) as K[]).find((k) => same(table[k], b));

/** How the timeline shows a blits ease; undefined for linear and for eases it cannot show. */
export function toWeasel(e: Easing | undefined): EasingSpec | undefined {
  if (e === undefined || e === 'linear' || typeof e === 'function') return undefined;
  if (typeof e === 'string') return { bezier: CSS[e] };
  if ('bezier' in e)
    return (nameOf(WEASEL, e.bezier) as EasingSpec | undefined) ?? { bezier: e.bezier };
  return undefined;
}

/**
 * A timeline ease as blits data: a CSS name when the points are one, else bezier points.
 * undefined is linear; null refuses a curve with no bezier form, such as bounce.
 */
export function toBlits(e: EasingSpec | undefined): Easing | undefined | null {
  if (e === undefined) return undefined;
  if (e === 'linear') return 'linear';
  const b = typeof e === 'string' ? WEASEL[e] : easingBezier(e);
  if (!b) return null;
  return nameOf(CSS, b) ?? { bezier: [b[0], b[1], b[2], b[3]] };
}
