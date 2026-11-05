import { axisChannel, numericOf } from './channels.js';
import type { RoleScratch } from './role.js';
import { meanTurn } from './turns.js';
import type { Channel } from './types.js';

/** By kit slot, the weight a voice gives each axis of a `vec` channel; undefined at full weight. */
export type AxisWeights = (readonly number[] | undefined)[];

/**
 * A voice's `axes` by kit slot, checked: each names a `vec` channel the patch writes whose axes
 * have a rest, with one weight from 0 to 1 per axis. Null where the voice names none.
 */
export function axisWeights(
  given: Readonly<Record<string, readonly number[] | undefined>> | undefined,
  writes: readonly string[],
  slotOf: ReadonlyMap<string, number>,
  channels: readonly Channel<unknown>[],
): AxisWeights | null {
  if (given === undefined) return null;
  const out: AxisWeights = new Array(channels.length).fill(undefined);
  for (const name of Object.keys(given)) {
    const ws = given[name];
    if (ws === undefined) continue;
    if (!writes.includes(name))
      throw new Error(`blits: axes names ${name}, which the patch does not write`);
    const channel = channels[slotOf.get(name) as number] as Channel<unknown>;
    const of = axisChannel(channel);
    if (of === undefined)
      throw new Error(
        `blits: axes names ${name}, which is not a vec channel; weigh a whole channel by weight`,
      );
    if (of.rest === undefined || of.scale === undefined)
      throw new Error(`blits: axes names ${name}, whose axes have no rest to fade toward`);
    const n = (channel.rest as unknown[]).length;
    if (ws.length !== n)
      throw new RangeError(`blits: axes gives ${name} ${ws.length} weights for its ${n} axes`);
    for (const w of ws)
      if (!(w >= 0 && w <= 1))
        throw new RangeError(`blits: axes gives ${name} a weight of ${w}, outside 0 to 1`);
    out[slotOf.get(name) as number] = ws.slice();
  }
  return out;
}

/** The full turn of an angle channel or of each axis of a `vec` of angles; 0 for any other. */
export function turnOf(channel: Channel<unknown>): number {
  return numericOf(channel)?.turn ?? numericOf(axisChannel(channel) ?? channel)?.turn ?? 0;
}

/**
 * `channel.fold(into, v, w)` for a `vec`, each axis at `w` times its own weight in `ws`, or at
 * `w` alone where `ws` is absent. An axis at weight 0 takes nothing.
 */
export function foldAxes(
  channel: Channel<unknown>,
  into: number[],
  v: ArrayLike<number>,
  w: number,
  ws: readonly number[] | undefined,
): number[] {
  const of = axisChannel(channel) as Channel<number>;
  const scale = of.scale as (v: number, w: number) => number;
  const fill = of.rest as number;
  for (let a = 0; a < into.length; a++) {
    const wa = ws === undefined ? w : w * (ws[a] as number);
    if (wa > 0) into[a] = of.merge(into[a] as number, scale(v[a] ?? fill, wa));
  }
  return into;
}

/**
 * Whether a role's members are folded for `slot` all at once rather than lerped in one by one:
 * an angle meets at its members' mean direction, and a member weighing axes apart is folded axis
 * by axis.
 */
export function together<I, O>(k: RoleScratch<I, O>, slot: number, turn: number): boolean {
  return turn > 0 || k.axial[slot] === 1;
}

/** Marks in `k.axial` each slot a member of role `group` weighs axis by axis; true if any. */
export function markAxial<I, O>(k: RoleScratch<I, O>, group: number): boolean {
  let any = false;
  for (let m = 0; m < k.m; m++) {
    if (k.mGroups[m] !== group) continue;
    const axes = k.mVoices[m]?.axes;
    if (axes === null || axes === undefined) continue;
    any = true;
    for (let s = 0; s < axes.length; s++) if (axes[s] !== undefined) k.axial[s] = 1;
  }
  return any;
}

/**
 * The value of a role's members `k.picks[slot]` for one channel, folded together: per axis, an
 * angle by its mean direction and anything else lerped in member order, each member at its
 * weight times its weight for the axis. A `vec`'s weight taken on each axis goes in
 * `k.axisTaken[slot]`, which the role then folds axis by axis.
 */
export function resolve<I, O>(
  k: RoleScratch<I, O>,
  slot: number,
  name: string,
  channel: Channel<unknown>,
  turn: number,
): unknown {
  const picks = k.picks[slot] as number[];
  const vs = k.turnVs;
  const ws = k.turnWs;
  const n = picks.length;
  const of = axisChannel(channel);
  if (of === undefined) {
    for (let j = 0; j < n; j++) {
      const m = picks[j] as number;
      vs[j] = (k.mDeltas[m] as Record<string, unknown>)[name] as number;
      ws[j] = k.mWeights[m] as number;
    }
    return meanTurn(vs, ws, 0, n, turn);
  }
  const fill = of.rest as number;
  const axes = (channel.rest as number[]).length;
  let out = k.axisOut[slot];
  if (out === undefined) {
    out = new Array<number>(axes).fill(fill);
    k.axisOut[slot] = out;
  }
  let taken = k.axisTakenOf[slot];
  if (taken === undefined) {
    taken = new Array<number>(axes).fill(0);
    k.axisTakenOf[slot] = taken;
  }
  k.axisTaken[slot] = taken;
  for (let a = 0; a < axes; a++) {
    let acc = fill;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const m = picks[j] as number;
      const f = k.mVoices[m]?.axes?.[slot]?.[a];
      const w = (k.mWeights[m] as number) * (f ?? 1);
      const v = ((k.mDeltas[m] as Record<string, unknown>)[name] as ArrayLike<number>)[a] ?? fill;
      if (turn > 0) {
        vs[j] = v;
        ws[j] = w;
        if (w > 0) sum += w;
        continue;
      }
      if (!(w > 0)) continue;
      const total = sum + w;
      acc = sum === 0 ? v : of.lerp(acc, v, w / total);
      sum = total;
    }
    out[a] = turn > 0 ? (sum > 0 ? meanTurn(vs, ws, 0, n, turn) : fill) : acc;
    taken[a] = sum;
  }
  return out;
}

/** Folds what `resolve` gave a `vec` into the pose's value, each axis at the weight it took. */
export function foldTaken(
  channel: Channel<unknown>,
  into: number[],
  value: ArrayLike<number>,
  taken: readonly number[],
): number[] {
  const of = axisChannel(channel) as Channel<number>;
  const scale = of.scale as (v: number, w: number) => number;
  for (let a = 0; a < into.length; a++) {
    const t = taken[a] as number;
    if (t > 0) into[a] = of.merge(into[a] as number, scale(value[a] as number, t > 1 ? 1 : t));
  }
  return into;
}
