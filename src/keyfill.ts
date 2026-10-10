import { foldNumber } from './channels.js';
import { clampWeight, frozenTime, phaseAt, same, weighed } from './clock.js';
import { unband } from './fold.js';
import { Arg, type Lane, type Laned, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import { shortWay } from './turns.js';

/**
 * A keys voice's fill outside a locus, its weight a number: what `one` does for each subject, in
 * one loop, so no weight or time crosses a call as a boxed double per subject.
 */
export function runKeys<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>): void {
  const voice = lane.voice;
  const data = lane.data;
  const per = lanes.per;
  const list = lane.list;
  const records = lane.records;
  const chans = lane.chans;
  const read = lane.values;
  const n = chans.length;
  const fills = lanes.fills;
  const lately = lanes.lately;
  const elapsedNow = voice.elapsedAt(lanes.now);
  const duration = voice.duration;
  const passes = voice.passes;
  const before = voice.freezesBefore;
  const after = voice.freezesAfter;
  const span = voice.span;
  const flat = lane.flat;
  const parts = voice.parts !== null;
  const whole = clampWeight(voice.weight);
  let width = 0;
  for (let i = 0; i < n; i++) width += (chans[i] as Laned).axes;
  if (lane.nums.length < width) lane.nums = new Float64Array(width);
  if (lane.kinds.length < n) lane.kinds = new Uint8Array(n);
  const nums = lane.nums;
  const kinds = lane.kinds;
  for (let p = 0; p < list.length; p++) {
    const slot = list[p] as number;
    const o = p * Row.STRIDE;
    if (per[slot * Per.SLOT + Per.LANE_FILL] === fills - 1)
      data[o + Row.PROBED] = data[o + Row.WEIGHT] as number;
    if (lately >= 0 && lanes.unread(slot)) continue;
    const elapsed = frozenTime(elapsedNow - (data[o + Row.DELAY] as number), before, after, span);
    if (!(elapsed >= 0)) {
      data[o + Row.WEIGHT] = 0;
      unband(records[p]);
      continue;
    }
    if (!flat) {
      const since = data[o + Row.SINCE] as number;
      if (!lane.weighed || !same(since, lane.weighedSince)) {
        lane.fade = lanes.host.envelope(voice, since);
        lane.weighed = true;
        lane.weighedSince = since;
      }
    }
    const w = flat && !parts ? whole : weighed(voice.weight, lane.fade, lanes.parting(voice, slot));
    data[o + Row.WEIGHT] = w;
    if (!lane.read || !same(elapsed, lane.readAt)) {
      lanes.readKeyed(voice, phaseAt(elapsed, duration, passes), lane.delta, lane.scratch);
      lane.read = true;
      lane.readAt = elapsed;
      lanes.gather(lane, lane.delta);
      flatten(chans, read, nums, kinds);
    }
    if (!(w > 0)) {
      unband(records[p]);
      continue;
    }
    let k = 0;
    for (let i = 0; i < n; i++) {
      const ch = chans[i] as Laned;
      const axes = ch.axes;
      const kind = kinds[i];
      if (kind === Kind.NUMBERS) {
        const values = ch.values;
        const base = slot * axes;
        for (let a = 0; a < axes; a++)
          values[base + a] = foldNumber(
            ch.op,
            values[base + a] as number,
            nums[k + a] as number,
            w,
          );
      } else if (kind === Kind.GATED) {
        lanes.folding = lane;
        lanes.rec = records[p] ?? null;
        lanes.arg[Arg.WEIGHT] = w;
        lanes.foldInto(ch, slot, read[i]);
      }
      k += axes;
    }
  }
}

/** How a keys read's value for a channel folds: not at all, as numbers, or through `foldInto`. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package
const enum Kind {
  ABSENT = 0,
  NUMBERS = 1,
  GATED = 2,
}

/**
 * A keys read's values as the numbers `foldInto` would fold, an array read past its end as the rest:
 * read here once per read, since reading a number out of a delta's array for each subject boxes it.
 */
function flatten(
  chans: readonly Laned[],
  read: readonly unknown[],
  nums: Float64Array,
  kinds: Uint8Array,
): void {
  let k = 0;
  for (let i = 0; i < chans.length; i++) {
    const ch = chans[i] as Laned;
    const value = read[i];
    if (value === undefined) kinds[i] = Kind.ABSENT;
    else if (!ch.plain) kinds[i] = unplain(ch, value, nums, k);
    else {
      kinds[i] = Kind.NUMBERS;
      if (ch.scalar) nums[k] = value as number;
      else {
        const arr =
          Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<number>) : null;
        for (let a = 0; a < ch.axes; a++)
          nums[k + a] = arr === null ? ch.rest : (arr[a] ?? ch.rest);
      }
    }
    k += ch.axes;
  }
}

/**
 * `flatten` for a channel that is not plain. An angle's number is taken the short way round here,
 * and then folds as the sum it is; a rest-less channel and a quat fold through `foldInto`.
 */
function unplain(ch: Laned, value: unknown, nums: Float64Array, k: number): Kind {
  if (!(ch.turn > 0)) return Kind.GATED;
  nums[k] = shortWay(value as number, ch.turn);
  return Kind.NUMBERS;
}
