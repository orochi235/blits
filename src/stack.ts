import { copy, first } from './clone.js';
import { bound, merged } from './fold.js';
import type { Channel, Kit } from './types.js';

/** The weight a mix's default band first switches a rest-less channel on at. */
const ON = 0.6;

/**
 * Folds deltas into one pose by a kit's arithmetic, in order, with no mix and no clock: what a mix
 * gives for voices contributing these deltas at these weights. Each channel starts at its rest, a
 * weight (default 1, held to 0..1) fades a delta toward rest, and the pose is clamped to each
 * channel's bounds. A channel with no rest takes the last delta whose weight is 0.6 or more, where
 * a mix's default band first switches one on, and stays undefined where none is.
 *
 * @category channel
 */
export function fold<O>(
  kit: Kit<O>,
  deltas: readonly Partial<O>[],
  weights?: readonly number[],
): O {
  const pose: Record<string, unknown> = {};
  const names = Object.keys(kit as object);
  for (const key of names) {
    const channel = (kit as Record<string, Channel<unknown>>)[key] as Channel<unknown>;
    const rest = channel.rest;
    pose[key] = rest === undefined ? undefined : channel.copy ? channel.copy(rest) : copy(rest);
  }
  for (let i = 0; i < deltas.length; i++) {
    const given = weights?.[i] ?? 1;
    const w = given > 1 ? 1 : given;
    if (!(w > 0)) continue;
    const delta = deltas[i] as Record<string, unknown>;
    for (const key of names) {
      const value = delta[key];
      if (value === undefined) continue;
      const channel = (kit as Record<string, Channel<unknown>>)[key] as Channel<unknown>;
      if (channel.rest !== undefined && channel.scale)
        pose[key] = channel.fold
          ? channel.fold(pose[key], value, w)
          : merged(channel, pose[key], channel.scale(value, w));
      else if (w >= ON)
        pose[key] = pose[key] === undefined ? first(value) : merged(channel, pose[key], value);
    }
  }
  for (const key of names) {
    const channel = (kit as Record<string, Channel<unknown>>)[key] as Channel<unknown>;
    if (channel.bounds) pose[key] = bound(channel, pose[key]);
  }
  return pose as O;
}
