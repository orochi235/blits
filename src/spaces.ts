import { roundsHue } from './color.js';
import type { Curve } from './easing.js';
import { closedLch } from './lch.js';
import { shared } from './shared.js';
import type { Channel } from './types.js';

/**
 * `closed` for a channel whose values are not points on a line: the stretch read from `x0`, `v0`
 * and `to` at `x`, `v` and `g`, solved in coordinates where it is one, and the position and
 * velocity at voice time `t` written back into `xo` and `vo` as the channel's own values.
 */
export type ClosedIn = (
  law: Float64Array,
  ease: Curve | undefined,
  at: number,
  ms: number,
  x0: ArrayLike<number>,
  x: number,
  v0: ArrayLike<number>,
  v: number,
  to: ArrayLike<number>,
  g: number,
  t: number,
  xo: Float64Array,
  vo: Float64Array,
) => boolean;

/**
 * The space a channel's values lie in, where a straight line through their numbers is not the way
 * the channel goes between them: a motion on it solves its stretches there instead.
 */
export interface Space {
  /** What the channel is, finishing "channel x …", for an error. */
  readonly is: string;
  /** What a motion on it moves, for an error. */
  readonly values: string;
  readonly axes: number;
  readonly closed: ClosedIn;
}

/** Round the hue, as `ink` and `color({ lerp: 'oklch' })` travel. */
export const HUE: Space = {
  is: 'goes round the hue',
  values: 'oklab() values, four numbers each',
  axes: 4,
  closed: closedLch,
};

const spaces = shared<object, Space>('motion-space@1');

/** Gives a stock channel the space a motion on it moves in. */
export function movesIn(channel: Channel<unknown>, space: Space): void {
  spaces.set(channel, space);
}

/** The space a motion on `channel` moves in; undefined where its numbers are a line. */
export function spaceOf(channel: Channel<unknown>): Space | undefined {
  return spaces.get(channel) ?? (roundsHue(channel) ? HUE : undefined);
}
