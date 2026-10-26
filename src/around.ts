import { curve } from './easing.js';
import type { Mixer } from './mixer.js';
import type { Circle, Easing, Signal } from './types.js';

/** Each `around` signal's circle, which a voice it weighs is bounded to as if cued `within` it. */
const circles = new WeakMap<object, Circle>();

/** The circle a weight carries: an `around` signal's own, or none. */
export const carried = (weight: unknown): Circle | undefined =>
  typeof weight === 'function' ? circles.get(weight) : undefined;

/**
 * `Mix.around`: 1 at the circle's center, falling with distance over the positions `plot` gave to 0
 * at `r` and beyond, along `ease` read from the edge (0) to the center (1).
 */
export function around<I, O>(
  this: Mixer<I, O>,
  circle: Circle,
  opts: { ease?: Easing } = {},
): Signal<I> {
  if (typeof circle !== 'object' || circle === null)
    throw new TypeError('blits: around takes a circle, { x, y, r }');
  const shape = curve(opts.ease ?? 'linear');
  const read = (subject: I): number => {
    const places = this.places;
    if (places === null) return 0;
    const i = places.cur >= 0 ? places.cur : (places.at.get(subject) ?? -1);
    const xy = places.xy;
    if (i < 0 || 2 * i + 1 >= xy.length) return 0;
    const r = circle.r;
    const dx = (xy[2 * i] as number) - circle.x;
    const dy = (xy[2 * i + 1] as number) - circle.y;
    const d2 = dx * dx + dy * dy;
    if (!(r > 0) || !(d2 <= r * r)) return 0;
    return shape(1 - Math.sqrt(d2) / r);
  };
  circles.set(read, circle);
  return read as Signal<I>;
}
