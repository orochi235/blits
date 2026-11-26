import { CURVE_WIDTH, curveData } from '../../easing.js';
import { builtOf } from '../../patch.js';
import type { Patch } from '../../types.js';
import { type ChannelLookup, EASING_FUNCTION, type Packed } from '../runner.js';
import type { ChannelCode } from '../wgsl/channels.js';
import { keysRunner, widthOf } from './keys.js';

/** A stop's value as `width` numbers, or undefined where the GPU cannot read it. */
export function numbersOf(value: unknown, width: number): ArrayLike<number> | undefined {
  if (width === 1) return typeof value === 'number' ? [value] : undefined;
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return undefined;
  const list = value as ArrayLike<unknown>;
  if (list.length !== width) return undefined;
  for (let i = 0; i < width; i++) if (typeof list[i] !== 'number') return undefined;
  return list as ArrayLike<number>;
}

/**
 * A `keys` patch's runner and numbers: its duration, then per track in `writes` order its delay,
 * its stop count, and per stop its phase, its curve and its value.
 */
export function keysPack(patch: object, channels: ChannelLookup): Packed | undefined {
  const p = patch as Patch<unknown, Record<string, unknown>, unknown>;
  if (p.form !== 'keys' || p.keys === undefined) return undefined;
  const built = builtOf(p);
  const values: number[] = [built.duration];
  const codes: ChannelCode[] = [];
  // A curve whose numbers outrun its slot, by where its head sits: the rest goes after every track.
  const tails: [head: number, rest: readonly number[]][] = [];
  for (const track of built.tracks) {
    const code = channels.get(track.channel);
    if (code === undefined || (code.lerp === undefined && code.lerpAll === undefined))
      return { why: `the GPU cannot interpolate ${track.channel}` };
    if (track.lerp !== undefined && track.lerp !== code.source)
      return { why: `${track.channel} interpolates by its own lerp` };
    if (track.all.length === 0) return { why: `${track.channel} has no stops` };
    const width = widthOf(code);
    values.push(track.delay, track.all.length);
    for (const [k, pt] of track.all.entries()) {
      // The first stop's easing shapes no segment, so the GPU never reads it.
      const curve = curveData(k === 0 ? undefined : pt.ease);
      if (curve === undefined) return { why: EASING_FUNCTION };
      const v = numbersOf(pt.value, width);
      if (v === undefined) return { why: 'a stop holds a value the GPU cannot read' };
      values.push(pt.at);
      if (curve.length > CURVE_WIDTH) tails.push([values.length, curve.slice(CURVE_WIDTH)]);
      values.push(...curve.slice(0, CURVE_WIDTH), ...Array.from(v));
    }
    codes.push(code);
  }
  for (const [head, rest] of tails) {
    values[head + 1] = values.length - head;
    values.push(...rest);
  }
  return {
    runner: keysRunner(
      built.tracks.map((t) => t.channel),
      codes,
    ),
    values: Float32Array.from(values),
  };
}
