import type { Easing, PennerName } from '@msb235/blits';
import type { EasingSpec } from '@weasel-js/core';
import { easingBezier } from '@weasel-js/geom';

type Bezier = readonly [number, number, number, number];
type CssName = 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';

export const CSS: Record<CssName, Bezier> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

const isCss = (s: string): s is CssName => Object.hasOwn(CSS, s);
const same = (a: readonly number[], b: readonly number[]) => a.every((x, i) => x === b[i]);
const nameOf = (b: readonly number[]) =>
  (Object.keys(CSS) as CssName[]).find((k) => same(CSS[k], b));

/** How the timeline shows a blits ease; undefined for linear and for eases it cannot show. */
export function toWeasel(e: Easing | undefined): EasingSpec | undefined {
  if (e === undefined || e === 'linear' || typeof e === 'function') return undefined;
  // weasel's named curves are blits' Penner names.
  if (typeof e === 'string') return isCss(e) ? { bezier: CSS[e] } : (e as EasingSpec);
  if ('bezier' in e) return { bezier: e.bezier };
  return undefined;
}

/**
 * A timeline ease as blits data: a named curve by its name, a CSS name when the points are one,
 * else bezier points. undefined is linear; null refuses a curve that is neither, such as a function.
 */
export function toBlits(e: EasingSpec | undefined): Easing | undefined | null {
  if (e === undefined) return undefined;
  if (e === 'linear') return 'linear';
  if (typeof e === 'string') return e as PennerName;
  const b = easingBezier(e);
  if (!b) return null;
  return nameOf(b) ?? { bezier: [b[0], b[1], b[2], b[3]] };
}
