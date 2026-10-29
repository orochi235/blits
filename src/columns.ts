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
 * each position's remembered chain head was current when the mix's `relinks` read `since`: what
 * `prepare` and `writeLater` do for each subject from position `from`, while the subject reads
 * from the lanes and its head has not been made stale since; returns the first position that does
 * not, or the list's length.
 */
export function pullRun<I, O>(
  lanes: Lanes<I, O>,
  slots: Int32Array,
  list: readonly I[],
  was: readonly I[],
  since: number,
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
  const unlinked = lanes.unlinked;
  const holds = lanes.holds;
  // Nothing in `pullRun` makes a subject owe a voice, so one with nobody owing need not ask.
  const owing = lanes.owed.any();
  const current = since === Number.POSITIVE_INFINITY;
  queueFor(lanes, columns, slots);
  room(lanes, lanes.queued + list.length - from);
  let n = from;
  // The run being gathered: its first slot and row, and how far it has reached.
  let first = -1;
  let start = from;
  for (; n < list.length; n++) {
    const subject = list[n] as I;
    if (was[n] !== subject) break;
    const slot = slots[n] as number;
    const o = slot * Per.SLOT;
    if (
      slot < 0 ||
      (!current && !((unlinked[slot] as number) <= since)) ||
      (per[o + Per.FILLED] as number) >= busy ||
      per[o + Per.IDLE] !== 0 ||
      (per[o + Per.SEEN] as number) < wide ||
      (owing && lanes.owes(slot))
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
    if (holds) subjects[slot] = subject;
    if (slot !== first + (n - start)) {
      if (first >= 0) add(lanes, first, start, n - start);
      first = slot;
      start = n;
    }
  }
  if (first >= 0) add(lanes, first, start, n - start);
  if (n > from && holds) lanes.holding = true;
  return n;
}

/**
 * Queues a subject's values for each column at subject `n`'s places, for a `pull` that reads
 * from the lanes while every voice is on one; `flush` writes what is queued, column by column. A
 * channel no lane holds is at rest. Anything queued is written before the lanes fill again.
 * `slots` holds each row's lane slot, `slot` among them.
 */
export function writeLater<I, O>(
  lanes: Lanes<I, O>,
  slot: number,
  columns: readonly Column[],
  n: number,
  slots: Int32Array,
): void {
  queueFor(lanes, columns, slots);
  add(lanes, slot, n, 1);
}

/** Writes what is queued for other columns or another array of slots before queuing for these. */
function queueFor<I, O>(lanes: Lanes<I, O>, columns: readonly Column[], slots: Int32Array): void {
  if (columns === lanes.queuedFor && slots === lanes.queueFrom) return;
  flush(lanes);
  lanes.queuedFor = columns;
  lanes.queueFrom = slots;
}

/**
 * The shortest run `flush` copies as a block from consecutive slots. A shorter one, as a list kept
 * dense by swap-remove leaves its slots, joins the rows before it in one run whose slots `flush`
 * reads row by row, so a run's cost is paid once a stretch of rows rather than once a few.
 */
const BLOCK = 16;

/** Queues `count` rows from `row`, whose slots follow one apart from `slot`. */
function add<I, O>(lanes: Lanes<I, O>, slot: number, row: number, count: number): void {
  const k = lanes.queued;
  if (k > 0) {
    const last = k - 1;
    const had = lanes.queueCounts[last] as number;
    if (row === (lanes.queueRows[last] as number) + had) {
      const first = lanes.queueSlots[last] as number;
      if (first >= 0 && slot === first + had) {
        lanes.queueCounts[last] = had + count;
        return;
      }
      if (count < BLOCK && (first < 0 || had < BLOCK)) {
        lanes.queueSlots[last] = -1;
        lanes.queueCounts[last] = had + count;
        return;
      }
    }
  }
  room(lanes, k + 1);
  lanes.queueSlots[k] = slot;
  lanes.queueRows[k] = row;
  lanes.queueCounts[k] = count;
  lanes.queued = k + 1;
}

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

/** The longest run of values `copies` copies itself: `set` takes a view, an object a run. */
const VIEWED = 256;

/** Copies a laned channel's values for every queued run into its rows, a block or row by row. */
function copies<I, O>(lanes: Lanes<I, O>, c: Column, values: Float64Array, runs: number): void {
  const slots = lanes.queueSlots;
  const rows = lanes.queueRows;
  const counts = lanes.queueCounts;
  const out = c.out;
  const axes = c.axes;
  const from = lanes.queueFrom as Int32Array;
  for (let r = 0; r < runs; r++) {
    const first = slots[r] as number;
    if (first < 0) {
      const row = rows[r] as number;
      const end = row + (counts[r] as number);
      if (axes === 1) for (let i = row; i < end; i++) out[i] = values[from[i] as number] as number;
      else
        for (let i = row; i < end; i++) {
          const at = i * axes;
          const base = (from[i] as number) * axes;
          for (let a = 0; a < axes; a++) out[at + a] = values[base + a] as number;
        }
      continue;
    }
    const at = (rows[r] as number) * axes;
    const base = first * axes;
    const span = (counts[r] as number) * axes;
    if (span > VIEWED) out.set(values.subarray(base, base + span), at);
    else for (let i = 0; i < span; i++) out[at + i] = values[base + i] as number;
  }
}
