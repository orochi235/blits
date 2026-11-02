import { numericOf } from '../../channels.js';
import type { Channel } from '../../types.js';

/**
 * A channel's WGSL: how many numbers a subject's value takes, its rest, and how a voice's value
 * `v` at weight `w` folds into `acc`. Each snippet works on `array<f32, N>` values named `acc`
 * and `v`, and `fold` assigns `acc`.
 */
export interface ChannelCode {
  readonly axes: number;
  readonly rest: readonly number[];
  readonly fold: string;
}

const NUMBER: Record<string, ChannelCode> = {
  sum: { axes: 1, rest: [0], fold: 'acc[0] = acc[0] + v[0] * w;' },
  mul: { axes: 1, rest: [1], fold: 'acc[0] = acc[0] * (1.0 + (v[0] - 1.0) * w);' },
  max: { axes: 1, rest: [0], fold: 'acc[0] = max(acc[0], v[0] * w);' },
};

/** The WGSL for a channel's rule, or undefined where the GPU has none and it stays on the CPU. */
export function codeFor(channel: Channel<unknown>): ChannelCode | undefined {
  const n = numericOf(channel);
  const plain = typeof channel.rest === 'number' && channel.bounds === undefined;
  if (plain && n !== undefined && n.axes === 1 && n.turn === undefined && n.op in NUMBER)
    return NUMBER[n.op];
  return undefined;
}
