import { curve } from './easing.js';
import type { Mixer } from './mixer.js';
import type { Ball, Easing, Signal } from './types.js';

/** Each `around` signal's ball, which a voice it weighs is bounded to as if cued `within` it. */
const balls = new WeakMap<object, Ball>();

/** The ball a weight carries: an `around` signal's own, or none. */
export const carried = (weight: unknown): Ball | undefined =>
  typeof weight === 'function' ? balls.get(weight) : undefined;

/**
 * `Mix.around`: 1 at the ball's center, falling with distance over the positions `plot` gave to 0
 * at `r` and beyond, along `ease` read from the edge (0) to the center (1).
 */
export function around<I, O>(
  this: Mixer<I, O>,
  ball: Ball,
  opts: { ease?: Easing } = {},
): Signal<I> {
  if (typeof ball !== 'object' || ball === null)
    throw new TypeError('blits: around takes a ball, { x, y?, z?, r }');
  const shape = curve(opts.ease ?? 'linear');
  const read = (subject: I): number => {
    const places = this.places;
    if (places === null) return 0;
    const i = places.cur >= 0 ? places.cur : (places.at.get(subject) ?? -1);
    if (i < 0 || !places.has(i)) return 0;
    const r = ball.r;
    let d2: number;
    if (places.axes === 2) {
      const dx = (places.xy[2 * i] as number) - ball.x;
      const dy = (places.xy[2 * i + 1] as number) - (ball.y ?? 0);
      d2 = dx * dx + dy * dy;
    } else d2 = places.d2(i, ball.x, ball.y ?? 0, ball.z ?? 0);
    if (!(r > 0) || !(d2 <= r * r)) return 0;
    return shape(1 - Math.sqrt(d2) / r);
  };
  balls.set(read, ball);
  return read as Signal<I>;
}
