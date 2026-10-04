import type { Easing } from '@msb235/blits';
import { type EasingSpec, resolveEasing } from '@weasel-js/core';
import { easingBezier } from '@weasel-js/ui';

type Bezier = readonly [number, number, number, number];
const NAMED: Record<string, Bezier> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

export function toWeasel(e: Easing | undefined): EasingSpec | undefined {
  if (e === undefined || e === 'linear' || typeof e === 'function') return undefined;
  if (typeof e === 'string') return { bezier: NAMED[e] as Bezier };
  if ('bezier' in e) return { bezier: e.bezier };
  return undefined;
}

export function toBlits(e: EasingSpec | undefined): Easing | undefined {
  if (e === undefined) return undefined;
  const b = easingBezier(e);
  return b ? { bezier: [b[0], b[1], b[2], b[3]] } : resolveEasing(e);
}
