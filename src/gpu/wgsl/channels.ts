import { numericOf } from '../../channels.js';
import { extremeOf } from '../../extremes.js';
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
  /** The channel's bounds, which its folded value is clamped to, as the CPU's `clamp` does. */
  readonly bounds?: readonly [number, number];
}

/** A number as a WGSL f32 literal. */
const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

const NUMBER: Record<string, ChannelCode> = {
  sum: { axes: 1, rest: [0], fold: 'acc[0] = acc[0] + v[0] * w;' },
  mul: { axes: 1, rest: [1], fold: 'acc[0] = acc[0] * (1.0 + (v[0] - 1.0) * w);' },
  max: { axes: 1, rest: [0], fold: 'acc[0] = max(acc[0], v[0] * w);' },
};

/** The WGSL for a channel's rule, or undefined where the GPU has none and it stays on the CPU. */
export function codeFor(channel: Channel<unknown>): ChannelCode | undefined {
  const code = ruleOf(channel);
  return code === undefined || channel.bounds === undefined
    ? code
    : { ...code, bounds: channel.bounds };
}

function ruleOf(channel: Channel<unknown>): ChannelCode | undefined {
  const n = numericOf(channel);
  const plain = typeof channel.rest === 'number';
  if (plain && n !== undefined && n.axes === 1 && n.turn === undefined && n.op in NUMBER)
    return NUMBER[n.op];
  const x = plain ? extremeOf(channel) : undefined;
  if (x?.op === 'min')
    return {
      axes: 1,
      rest: [x.top],
      fold: `acc[0] = min(acc[0], ${f(x.top)} + (v[0] - ${f(x.top)}) * w);`,
    };
  if (x?.op === 'norm') {
    const p = f(x.power);
    const q = f(1 / x.power);
    return {
      axes: 1,
      rest: [0],
      fold: `let s = v[0] * w; if (acc[0] == 0.0) { acc[0] = s; } else if (s != 0.0) { let u = sign(acc[0]) * pow(abs(acc[0]), ${p}) + sign(s) * pow(abs(s), ${p}); acc[0] = sign(u) * pow(abs(u), ${q}); }`,
    };
  }
  return undefined;
}
