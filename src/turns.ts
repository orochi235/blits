import { doubles } from './channels.js';
import type { Laned } from './lane.js';

/** `d` less whole turns, so within half a turn of 0: the short way round a circle of `turn`. */
export function shortWay(d: number, turn: number): number {
  return d - turn * Math.round(d / turn);
}

type Fold = (into: number[], v: unknown, w: number) => ArrayLike<number>;
type Lerp = (a: number[], b: unknown, u: number) => ArrayLike<number>;

let held = doubles(4, 0);
let other = doubles(4, 0);

/** A subject's numbers on a lane as an array a channel's own functions take: `to`, or one as long. */
function lift(values: Float64Array, base: number, axes: number, to: number[]): number[] {
  const out = to.length === axes ? to : doubles(axes, 0);
  for (let a = 0; a < axes; a++) out[a] = values[base + a] as number;
  return out;
}

/**
 * Folds a rotation's value into a subject's numbers at `base`, at weight `w`, in the channel's own
 * arithmetic: an angle the short way round and then as a sum, anything else through the channel's
 * `fold`, which takes its axes as one value.
 */
export function turnInto(
  ch: Laned,
  values: Float64Array,
  base: number,
  value: unknown,
  w: number,
): void {
  if (ch.turn > 0) {
    values[base] = (values[base] as number) + shortWay(value as number, ch.turn) * w;
    return;
  }
  const axes = ch.axes;
  held = lift(values, base, axes, held);
  const out = (ch.channel.fold as unknown as Fold)(held, value, w);
  for (let a = 0; a < axes; a++) values[base + a] = out[a] as number;
}

/** `turnInto` for a value held as numbers at `from` in `source`, as a locus holds what it gathered. */
export function turnFrom(
  ch: Laned,
  values: Float64Array,
  base: number,
  source: Float64Array,
  from: number,
  w: number,
): void {
  if (ch.turn > 0) {
    turnInto(ch, values, base, source[from], w);
    return;
  }
  other = lift(source, from, ch.axes, other);
  turnInto(ch, values, base, other, w);
}

/**
 * A locus member's rotation lerped by `u` into what the members before it left at `base`, through
 * the channel's own `lerp`; the first member's value as it is, where `taken` is 0.
 */
export function turnToward(
  ch: Laned,
  values: Float64Array,
  base: number,
  value: unknown,
  taken: number,
  u: number,
): void {
  if (ch.turn > 0) {
    const was = values[base] as number;
    const v = value as number;
    values[base] = taken === 0 ? v : was + shortWay(v - was, ch.turn) * u;
    return;
  }
  const axes = ch.axes;
  let out = value as ArrayLike<number>;
  if (taken !== 0) {
    held = lift(values, base, axes, held);
    out = (ch.channel.lerp as unknown as Lerp)(held, value, u);
  }
  for (let a = 0; a < axes; a++) values[base + a] = out[a] as number;
}

/** Sets every numbered subject's values on a lane to the channel's rest, as a fill starts from. */
export function rested(ch: Laned, size: number): void {
  const values = ch.values;
  const axes = ch.axes;
  if (ch.op !== 'own') {
    values.fill(ch.rest, 0, size * axes);
    return;
  }
  const start = ch.start;
  for (let i = 0; i < size * axes; i += axes)
    for (let a = 0; a < axes; a++) values[i + a] = start[a] as number;
}
