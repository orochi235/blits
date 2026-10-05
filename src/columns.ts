import { Begin, Per } from './lane.js';
import type { Lanes } from './lanes.js';

/** One channel `pull` writes: where in the kit, how many numbers a subject, and its rest. */
export interface Column {
  key: string;
  slot: number;
  axes: number;
  out: Float64Array;
  /** The rest, clamped, or NaN for a channel with none. */
  rest: Float64Array;
  bounds: readonly [number, number] | undefined;
}

export function clampRun(
  out: Float64Array,
  at: number,
  n: number,
  [lo, hi]: readonly [number, number],
): void {
  for (let i = at; i < at + n; i++) {
    const x = out[i] as number;
    out[i] = x < lo ? lo : x > hi ? hi : x;
  }
}

/**
 * For a `pull` of a list it read last time in the same order, with every voice on a lane, where
 * `heads` holds each position's remembered chain head unless all are known current: what
 * `prepare` and `writeLater` do for each subject from position `from`, while the subject reads
 * from the lanes; returns the first position that does not, or the list's length.
 */
export function pullRun<I, O>(
  lanes: Lanes<I, O>,
  slots: Int32Array,
  list: readonly I[],
  was: readonly I[],
  heads: readonly ({ version: number } | undefined)[] | null,
  from: number,
  columns: readonly Column[],
  now: number,
  version: number,
): number {
  const ready = lanes.filled(now, version) ? Begin.READY : lanes.begin(now, version);
  if (ready !== Begin.READY || !lanes.whole) return from;
  const per = lanes.per;
  const fills = lanes.fills;
  const wide = lanes.wide;
  const frame = lanes.frameProbes;
  const subjects = lanes.subjects;
  let n = from;
  for (; n < list.length; n++) {
    const subject = list[n] as I;
    if (was[n] !== subject || (heads !== null && heads[n]?.version !== version)) break;
    const slot = slots[n] as number;
    const o = slot * Per.SLOT;
    if (
      slot < 0 ||
      per[o + Per.FILLED] !== fills ||
      per[o + Per.IDLE] !== 0 ||
      (per[o + Per.SEEN] as number) < wide ||
      lanes.owes(slot)
    )
      break;
    if (
      !(
        (per[o + Per.LANE_PROBE] as number) > frame ||
        (per[o + Per.GENERAL_PROBE] as number) > frame
      )
    )
      lanes.distinct++;
    per[o + Per.LANE_PROBE] = ++lanes.probes;
    per[o + Per.LANE_FILL] = fills;
    subjects[slot] = subject;
    writeLater(lanes, slot, columns, n);
  }
  if (n > from) lanes.holding = true;
  return n;
}

/**
 * Queues a subject's values for each column at subject `n`'s places, for a `pull` that reads
 * from the lanes while every voice is on one; `flush` writes what is queued, column by column. A
 * channel no lane holds is at rest. Anything queued is written before the lanes fill again.
 */
export function writeLater<I, O>(
  lanes: Lanes<I, O>,
  slot: number,
  columns: readonly Column[],
  n: number,
): void {
  if (columns !== lanes.queuedFor) {
    flush(lanes);
    lanes.queuedFor = columns;
  }
  const k = lanes.queued;
  if (k === lanes.queueSlots.length) {
    const slots = new Int32Array(Math.max(64, k * 2));
    slots.set(lanes.queueSlots);
    lanes.queueSlots = slots;
    const rows = new Int32Array(slots.length);
    rows.set(lanes.queueRows);
    lanes.queueRows = rows;
  }
  lanes.queueSlots[k] = slot;
  lanes.queueRows[k] = n;
  if (
    k > 0 &&
    (slot !== (lanes.queueSlots[k - 1] as number) + 1 ||
      n !== (lanes.queueRows[k - 1] as number) + 1)
  )
    lanes.inOrder = false;
  lanes.queued = k + 1;
}

export function flush<I, O>(lanes: Lanes<I, O>): void {
  const count = lanes.queued;
  const columns = lanes.queuedFor;
  if (count === 0 || columns === null) return;
  lanes.queued = 0;
  // Subjects numbered in the order the host lists them: each column is one block.
  const block = lanes.inOrder;
  lanes.inOrder = true;
  const slots = lanes.queueSlots;
  const rows = lanes.queueRows;
  for (let k = 0; k < columns.length; k++) {
    const c = columns[k] as Column;
    const axes = c.axes;
    const out = c.out;
    const ch = lanes.bySlot[c.slot];
    if (ch === undefined) {
      for (let i = 0; i < count; i++) {
        const at = (rows[i] as number) * axes;
        for (let a = 0; a < axes; a++) out[at + a] = c.rest[a] as number;
      }
      continue;
    }
    const values = ch.values;
    if (block) {
      const s0 = (slots[0] as number) * axes;
      out.set(values.subarray(s0, s0 + count * axes), (rows[0] as number) * axes);
    } else if (axes === 1) {
      for (let i = 0; i < count; i++) out[rows[i] as number] = values[slots[i] as number] as number;
    } else
      for (let i = 0; i < count; i++) {
        const at = (rows[i] as number) * axes;
        const base = (slots[i] as number) * axes;
        for (let a = 0; a < axes; a++) out[at + a] = values[base + a] as number;
      }
    if (c.bounds !== undefined)
      for (let i = 0; i < count; i++) clampRun(out, (rows[i] as number) * axes, axes, c.bounds);
  }
}
