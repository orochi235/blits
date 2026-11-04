import { curveData } from '../../easing.js';
import { builtOf } from '../../patch.js';
import type { Patch } from '../../types.js';
import type { ChannelLookup, Packed } from '../runner.js';
import type { ChannelCode } from '../wgsl/channels.js';
import { keysRunner, widthOf } from './keys.js';

/** A stop's value as `width` numbers, or undefined where the GPU cannot read it. */
function numbersOf(value: unknown, width: number): ArrayLike<number> | undefined {
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
  for (const track of built.tracks) {
    const code = channels.get(track.channel);
    if (code === undefined || (code.lerp === undefined && code.lerpAll === undefined))
      return { why: `the GPU cannot interpolate ${track.channel}` };
    if (track.lerp !== undefined && track.lerp !== code.source)
      return { why: `${track.channel} interpolates by its own lerp` };
    if (track.all.length === 0) return { why: `${track.channel} has no stops` };
    const width = widthOf(code);
    values.push(track.delay, track.all.length);
    for (const pt of track.all) {
      const curve = curveData(pt.ease);
      if (curve === undefined) return { why: 'its easing is a function' };
      const v = numbersOf(pt.value, width);
      if (v === undefined) return { why: 'a stop holds a value the GPU cannot read' };
      values.push(pt.at, ...curve, ...Array.from(v));
    }
    codes.push(code);
  }
  return {
    runner: keysRunner(
      built.tracks.map((t) => t.channel),
      codes,
    ),
    values: Float32Array.from(values),
  };
}
