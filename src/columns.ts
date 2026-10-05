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
  const busy = lanes.busyFill;
  const wide = lanes.wide;
  const frame = lanes.frameProbes;
  const subjects = lanes.subjects;
  if (columns !== lanes.queuedFor) {
    flush(lanes);
    lanes.queuedFor = columns;
  }
  room(lanes, lanes.queued + list.length - from);
  const qSlots = lanes.queueSlots;
  const qRows = lanes.queueRows;
  const qCounts = lanes.queueCounts;
  let k = lanes.queued;
  let n = from;
  // The run being gathered: its first slot and row, and how far it has reached.
  let first = -1;
  let start = from;
  for (; n < list.length; n++) {
    const subject = list[n] as I;
    if (was[n] !== subject || (heads !== null && heads[n]?.version !== version)) break;
    const slot = slots[n] as number;
    const o = slot * Per.SLOT;
    if (
      slot < 0 ||
      (per[o + Per.FILLED] as number) >= busy ||
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
    if (slot !== first + (n - start)) {
      if (first >= 0) {
        qSlots[k] = first;
        qRows[k] = start;
        qCounts[k] = n - start;
        k++;
      }
      first = slot;
      start = n;
    }
  }
  if (first >= 0) {
    qSlots[k] = first;
    qRows[k] = start;
    qCounts[k] = n - start;
    k++;
  }
  lanes.queued = k;
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
  queue(lanes, columns, slot, n, 1);
}

/** Queues `count` subjects from lane slot `slot` for rows from `row`, one apart in both. */
function queue<I, O>(
  lanes: Lanes<I, O>,
  columns: readonly Column[],
  slot: number,
  row: number,
  count: number,
): void {
  if (columns !== lanes.queuedFor) {
    flush(lanes);
    lanes.queuedFor = columns;
  }
  const k = lanes.queued;
  if (k > 0) {
    const last = k - 1;
    const had = lanes.queueCounts[last] as number;
    if (
      slot === (lanes.queueSlots[last] as number) + had &&
      row === (lanes.queueRows[last] as number) + had
    ) {
      lanes.queueCounts[last] = had + count;
      return;
    }
  }
  room(lanes, k + 1);
  lanes.queueSlots[k] = slot;
  lanes.queueRows[k] = row;
  lanes.queueCounts[k] = count;
  lanes.queued = k + 1;
}

/** Makes room in the queue for `runs` runs. */
function room<I, O>(lanes: Lanes<I, O>, runs: number): void {
  if (runs <= lanes.queueSlots.length) return;
  const size = Math.max(64, runs, lanes.queueSlots.length * 2);
  lanes.queueSlots = grown(lanes.queueSlots, size);
  lanes.queueRows = grown(lanes.queueRows, size);
  lanes.queueCounts = grown(lanes.queueCounts, size);
}

function grown(a: Int32Array<ArrayBuffer>, size: number): Int32Array<ArrayBuffer> {
  const b = new Int32Array(size);
  b.set(a);
  return b;
}

/** Writes every queued run into its columns: a channel's values as a block, a rest as a fill. */
export function flush<I, O>(lanes: Lanes<I, O>): void {
  const runs = lanes.queued;
  const columns = lanes.queuedFor;
  if (runs === 0 || columns === null) return;
  lanes.queued = 0;
  for (let k = 0; k < columns.length; k++) {
    const c = columns[k] as Column;
    const ch = lanes.bySlot[c.slot];
    if (ch === undefined) rests(lanes, c, runs);
    else copies(lanes, c, ch.values, runs);
    if (c.bounds !== undefined)
      for (let r = 0; r < runs; r++)
        clampRun(
          c.out,
          (lanes.queueRows[r] as number) * c.axes,
          (lanes.queueCounts[r] as number) * c.axes,
          c.bounds,
        );
  }
}

// A typed array's `fill` and `set` cost more to call than a short run costs to copy.

/** Writes a column's rest into every queued run's rows. */
function rests<I, O>(lanes: Lanes<I, O>, c: Column, runs: number): void {
  const rows = lanes.queueRows;
  const counts = lanes.queueCounts;
  const out = c.out;
  const axes = c.axes;
  if (axes === 1) {
    const v = c.rest[0] as number;
    for (let r = 0; r < runs; r++) {
      const at = rows[r] as number;
      const end = at + (counts[r] as number);
      if (end - at > 64) out.fill(v, at, end);
      else for (let i = at; i < end; i++) out[i] = v;
    }
    return;
  }
  for (let r = 0; r < runs; r++) {
    const at = (rows[r] as number) * axes;
    const end = at + (counts[r] as number) * axes;
    for (let i = at; i < end; i += axes)
      for (let a = 0; a < axes; a++) out[i + a] = c.rest[a] as number;
  }
}

/** Copies a laned channel's values for every queued run into its rows. */
function copies<I, O>(lanes: Lanes<I, O>, c: Column, values: Float64Array, runs: number): void {
  const slots = lanes.queueSlots;
  const rows = lanes.queueRows;
  const counts = lanes.queueCounts;
  const out = c.out;
  const axes = c.axes;
  for (let r = 0; r < runs; r++) {
    const at = (rows[r] as number) * axes;
    const base = (slots[r] as number) * axes;
    const span = (counts[r] as number) * axes;
    if (span > 64) out.set(values.subarray(base, base + span), at);
    else for (let i = 0; i < span; i++) out[at + i] = values[base + i] as number;
  }
}
