import { axesOf } from './channels.js';
import { copy } from './clone.js';
import type { Column } from './pull.js';
import type { Subject } from './subject.js';
import type { Channel } from './types.js';

/** One `pull`'s subjects and the numbers it wrote for them, column by column. */
interface Pulled<I> {
  list: I[];
  keys: string[];
  axes: number[];
  data: Float64Array[];
  /** Each subject's position in `list`, made the first time a retarget asks. */
  index: Map<I, number> | null;
}

/** Every `pull` made at one mix time. */
interface Frame<I> {
  at: number;
  pulls: Pulled<I>[];
  count: number;
}

const frame = <I>(): Frame<I> => ({ at: Number.NaN, pulls: [], count: 0 });

/**
 * The last two frames `pull` read, kept as copies of its columns: the first retarget from
 * `'current'` takes the speed to leave at from them, as the mix keeps no poses until one is cued.
 * Copying the columns costs nothing a `pull` would notice, where keeping a pose a subject would.
 */
export class Trail<I> {
  private now: Frame<I> = frame();
  private before: Frame<I> = frame();

  record(at: number, list: readonly I[], columns: readonly Column[]): void {
    if (this.now.at !== at) {
      const spare = this.before;
      this.before = this.now;
      this.now = spare;
      spare.at = at;
      spare.count = 0;
    }
    const f = this.now;
    let p = f.pulls[f.count];
    if (p === undefined) {
      p = { list: [], keys: [], axes: [], data: [], index: null };
      f.pulls.push(p);
    }
    f.count++;
    const n = list.length;
    p.list.length = n;
    for (let i = 0; i < n; i++) p.list[i] = list[i] as I;
    p.index = null;
    p.keys.length = columns.length;
    p.axes.length = columns.length;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c] as Column;
      const len = n * col.axes;
      let data = p.data[c];
      if (data === undefined || data.length < len) {
        data = new Float64Array(Math.max(len, 64));
        p.data[c] = data;
      }
      data.set(col.out.subarray(0, len));
      p.keys[c] = col.key;
      p.axes[c] = col.axes;
    }
  }

  /** The subject's last two frames here, latest first, each with the channels pulled for it. */
  frames(subject: I): { at: number; pose: Record<string, unknown> }[] {
    const out: { at: number; pose: Record<string, unknown> }[] = [];
    for (const f of [this.now, this.before]) {
      if (Number.isNaN(f.at)) continue;
      const pose = poseIn(f, subject);
      if (pose !== undefined) out.push({ at: f.at, pose });
    }
    return out;
  }

  clear(): void {
    this.now = frame();
    this.before = frame();
  }
}

/** What a frame's pulls wrote for `subject`, the latest pull first; undefined where none read it. */
function poseIn<I>(f: Frame<I>, subject: I): Record<string, unknown> | undefined {
  let pose: Record<string, unknown> | undefined;
  for (let k = f.count - 1; k >= 0; k--) {
    const p = f.pulls[k] as Pulled<I>;
    if (p.index === null) {
      p.index = new Map();
      for (let i = p.list.length - 1; i >= 0; i--) p.index.set(p.list[i] as I, i);
    }
    const i = p.index.get(subject);
    if (i === undefined) continue;
    pose ??= {};
    for (let c = 0; c < p.keys.length; c++) {
      const key = p.keys[c] as string;
      if (key in pose) continue;
      const axes = p.axes[c] as number;
      const data = p.data[c] as Float64Array;
      const v = valueAt(data, i * axes, axes);
      if (v !== undefined) pose[key] = v;
    }
  }
  return pose;
}

/** One frame's pose of a subject, and whether it holds every channel or only those pulled. */
export interface Sample {
  at: number;
  pose: Record<string, unknown>;
  whole: boolean;
}

/**
 * Every probed subject's last two poses, where a host probes into its own object and the mix keeps
 * no poses: one row a subject in one buffer, its number on the subject's chain head, so a probe
 * makes no lookup and allocates nothing for it. Typed arrays a head, or a plain object written by
 * key, cost a 10,000-subject probe frame 30–60% (2026-11-08). A row holds its two frames' times and
 * which half is the latest, then both halves; a value that is not numbers goes in `other`.
 */
export class Probes {
  private readonly names: readonly string[];
  /** Where each channel's numbers start in a half; the last entry is the half's width. */
  private readonly layout: Int32Array;
  private readonly width: number;
  private readonly stride: number;
  private rows = new Float64Array(0);
  private other: unknown[] = [];
  private count = 0;
  private free: number[] = [];
  /** Moved on by a seek: a head noted before then holds a row no longer its own. */
  epoch = 0;

  constructor(names: readonly string[], channels: readonly Channel<unknown>[]) {
    this.names = names;
    const at = new Int32Array(channels.length + 1);
    for (let i = 0; i < channels.length; i++)
      at[i + 1] = (at[i] as number) + axesOf(channels[i] as Channel<unknown>);
    this.layout = at;
    this.width = at[channels.length] as number;
    this.stride = 3 + 2 * this.width;
  }

  /** Copies a probe's pose into the head's row, over the older half once the frame moves on. */
  note(
    head: Subject<unknown>,
    pose: Record<string, unknown>,
    clock: { readonly now: number },
  ): void {
    // Read here, not passed: a double handed to a call V8 does not inline is boxed, 16 B a probe.
    const now = clock.now;
    const rows = this.rowOf(head);
    const base = head.probeRow * this.stride;
    if (rows[base] !== now) {
      rows[base + 1] = rows[base] as number;
      rows[base] = now;
      rows[base + 2] = 1 - (rows[base + 2] as number);
    }
    const half = rows[base + 2] as number;
    const into = base + 3 + half * this.width;
    const others = (head.probeRow * 2 + half) * this.names.length;
    const names = this.names;
    const layout = this.layout;
    const other = this.other;
    for (let i = 0; i < names.length; i++) {
      const v = pose[names[i] as string];
      const from = into + (layout[i] as number);
      const axes = (layout[i + 1] as number) - (layout[i] as number);
      if (typeof v === 'number' && axes === 1) {
        rows[from] = v;
        if (other[others + i] !== undefined) other[others + i] = undefined;
      } else if (Array.isArray(v) && v.length === axes && typeof v[0] === 'number') {
        for (let a = 0; a < axes; a++) rows[from + a] = v[a] as number;
        if (other[others + i] !== undefined) other[others + i] = undefined;
      } else {
        rows[from] = Number.NaN;
        other[others + i] = copy(v);
      }
    }
  }

  /** The head's row, given one first where it has none since the last seek. */
  private rowOf(head: Subject<unknown>): Float64Array {
    if (head.probeEpoch === this.epoch && head.probeRow >= 0) return this.rows;
    const row = this.free.length > 0 ? (this.free.pop() as number) : this.count++;
    if ((row + 1) * this.stride > this.rows.length) {
      const grown = new Float64Array(Math.max(64, row + 1) * 2 * this.stride);
      grown.set(this.rows);
      this.rows = grown;
      const want = (grown.length / this.stride) * 2 * this.names.length;
      for (let i = this.other.length; i < want; i++) this.other.push(undefined);
    }
    head.probeRow = row;
    head.probeEpoch = this.epoch;
    const base = row * this.stride;
    // A time no frame has, so the note that follows takes the row's first half as its latest.
    this.rows[base] = Number.NaN;
    this.rows[base + 1] = Number.NaN;
    this.rows[base + 2] = 1;
    const o = row * 2 * this.names.length;
    this.other.fill(undefined, o, o + 2 * this.names.length);
    return this.rows;
  }

  /** Gives a dropped subject's row back. */
  release(head: Subject<unknown>): void {
    if (head.probeEpoch === this.epoch && head.probeRow >= 0) this.free.push(head.probeRow);
    head.probeRow = -1;
  }

  /** Forgets every row, as a seek makes them stale. */
  clear(): void {
    this.epoch++;
    this.count = 0;
    this.free = [];
  }

  /** The poses noted on a head, latest first, pushed onto `out`; none from before a seek. */
  samples(head: Subject<unknown> | undefined, out: Sample[]): void {
    if (head === undefined || head.probeEpoch !== this.epoch || head.probeRow < 0) return;
    const base = head.probeRow * this.stride;
    const half = this.rows[base + 2] as number;
    const at = this.rows[base] as number;
    const prevAt = this.rows[base + 1] as number;
    out.push({ at, pose: this.poseOf(head.probeRow, half), whole: true });
    if (!Number.isNaN(prevAt))
      out.push({ at: prevAt, pose: this.poseOf(head.probeRow, 1 - half), whole: true });
  }

  /** One half of a row as a pose: a channel with no number and no other value is left out. */
  private poseOf(row: number, half: number): Record<string, unknown> {
    const pose: Record<string, unknown> = {};
    const from0 = row * this.stride + 3 + half * this.width;
    const others = (row * 2 + half) * this.names.length;
    for (let i = 0; i < this.names.length; i++) {
      const key = this.names[i] as string;
      const from = from0 + (this.layout[i] as number);
      const axes = (this.layout[i + 1] as number) - (this.layout[i] as number);
      const kept = this.other[others + i];
      if (kept !== undefined) pose[key] = kept;
      else {
        const v = valueAt(this.rows, from, axes);
        if (v !== undefined) pose[key] = v;
      }
    }
    return pose;
  }
}

/** The value `axes` numbers from `at` hold, or undefined where one is NaN, standing for none. */
function valueAt(data: Float64Array, at: number, axes: number): number | number[] | undefined {
  if (axes === 1) {
    const v = data[at] as number;
    return Number.isNaN(v) ? undefined : v;
  }
  const v = Array.from(data.subarray(at, at + axes));
  return v.some(Number.isNaN) ? undefined : v;
}
