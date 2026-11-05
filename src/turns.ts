import { blendRuleOf } from './blend-modes.js';
import { doubles } from './channels.js';
import type { Laned, Role } from './lane.js';

/** `d` less whole turns, so within half a turn of 0: the short way round a circle of `turn`. */
export function shortWay(d: number, turn: number): number {
  return d - turn * Math.round(d / turn);
}

/**
 * The angles `vs[from..to)` at weights `ws`, folded as alternatives in a role: each taken the
 * short way to the direction they average to, then averaged by weight, so the answer is the same
 * in any order. Where the directions cancel there is no way round between them, and each is taken
 * the short way from 0. Weights of 0 or less are passed over; with none left the answer is 0.
 */
export function meanTurn(
  vs: ArrayLike<number>,
  ws: ArrayLike<number>,
  from: number,
  to: number,
  turn: number,
): number {
  const k = (2 * Math.PI) / turn;
  let first = Number.NaN;
  let total = 0;
  let sin = 0;
  let cos = 0;
  for (let i = from; i < to; i++) {
    const w = ws[i] as number;
    if (!(w > 0)) continue;
    const v = vs[i] as number;
    if (total === 0) first = v;
    total += w;
    // Measured from the first, so one member gives its own value to the bit.
    const d = shortWay(v - first, turn) * k;
    sin += w * Math.sin(d);
    cos += w * Math.cos(d);
  }
  if (total === 0) return 0;
  const cancels = Math.hypot(sin, cos) < 1e-9 * total;
  const mean = cancels ? 0 : Math.atan2(sin, cos) / k;
  let sum = 0;
  for (let i = from; i < to; i++) {
    const w = ws[i] as number;
    if (!(w > 0)) continue;
    const v = vs[i] as number;
    sum += w * (cancels ? shortWay(v, turn) : shortWay(v - first - mean, turn));
  }
  return cancels ? sum / total : first + mean + sum / total;
}

/** Keeps a role member's angle for the subject at `slot`, which `foldTurn` folds with the others. */
export function gatherTurn<I, O>(
  g: Role<I, O>,
  k: number,
  cap: number,
  slot: number,
  member: number,
  value: number,
  w: number,
): void {
  const m = g.members.length;
  let vs = g.turnValues[k];
  let ws = g.turnWeights[k];
  if (vs === undefined || ws === undefined) {
    vs = new Float64Array(cap * m);
    ws = new Float64Array(cap * m);
    g.turnValues[k] = vs;
    g.turnWeights[k] = ws;
  }
  vs[slot * m + member] = value;
  ws[slot * m + member] = w;
}

/** Folds a role's angles for the subject at `slot` into its laned value, at weight `w`. */
export function foldTurn<I, O>(ch: Laned, g: Role<I, O>, slot: number, w: number): void {
  const m = g.members.length;
  const v = meanTurn(
    g.turnValues[ch.index] as Float64Array,
    g.turnWeights[ch.index] as Float64Array,
    slot * m,
    (slot + 1) * m,
    ch.turn,
  );
  ch.values[slot] = (ch.values[slot] as number) + shortWay(v, ch.turn) * w;
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

/** `turnInto` for a value held as numbers at `from` in `source`, as a role holds what it gathered. */
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
 * A role member's value for a channel not lerped straight across, lerped by `u` into what the
 * members before it left at `base` through the channel's own `lerp`, or an angle's short way round;
 * the first member's value as it is, where `taken` is 0.
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
  // A stack keeps a first contribution as it is, padded: its fold and lerp tell one from a stack,
  // and laying it as a layer now would clip its color before the next member is lerped in.
  if (taken === 0 && out.length < axes && blendRuleOf(ch.channel)?.kind === 'stack') {
    for (let a = 0; a < axes; a++) values[base + a] = (out[a] as number | undefined) ?? 0;
    return;
  }
  // A first value of other axes than the lane's, as an ink contribution is, widens through the lerp.
  if (taken !== 0 || out.length !== axes) {
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
