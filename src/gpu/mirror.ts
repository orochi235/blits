import type { Motions } from '../motions.js';
import { reading } from '../reading.js';
import { RunFlag, type Segment } from '../stretch.js';
import { warnOnce } from '../warn.js';
import { Anchors } from './anchors.js';
import { Numbering } from './numbering.js';
import { putRun, rangesOf, spliced } from './run-row.js';

/** The warning where two voices fold one motion patch, each taking its one watch from the other. */
export const SHARED =
  'one motion patch is folded by two voices at once, on one mix or two, so the gpu engine rebuilds its mirror of the patch every frame; give each voice a patch of its own';

const PENDING = RunFlag.PENDING;
const OLDER = RunFlag.OLDER;

/**
 * A motion voice's runs as the GPU reads them: each registered subject's run, in registration
 * order, kept in step with its `Motions` by `watch`. A subject the patch has not met yet gets the
 * row its first stretch would have, without the patch numbering it: registering is not meeting.
 * Before each dispatch, `prepare` commits the changes due by each subject's time, as a live
 * `sample` would, since a host reading only the GPU's buffers makes none; `take` then hands over
 * the rows that changed.
 */
export class Mirror<I> {
  /** Each registered subject's run, `stride` numbers apiece, its release time counted from its anchor. */
  rows = new Float32Array(0);
  stride = 0;
  private readonly anchors = new Anchors();
  /** Rows moved to a new anchor since the last `take`, `[from, to)`. */
  private moved: [number, number] | null = null;
  private numbering: Numbering<I>;
  /** Subject numbers whose run or pending changes moved, or that were given up, since the last `prepare`. */
  private touched = new Set<number>();
  /** Subject numbers with a change still to come or an earlier stretch kept, met every frame. */
  private due = new Set<number>();
  /** Rows written since the last `take`. */
  private dirty = new Set<number>();
  /** Set where every row is written at the next `prepare`, as after numbering. */
  private rewrite = false;
  /** Set where `take` hands over every row as one range, as after a rewrite or a new anchor. */
  private all = false;
  private times: [number, number] = [Number.NaN, Number.NaN];
  private detached = false;
  private vals: Float32Array;
  private readonly listen = (s: number) => {
    this.touched.add(s);
  };

  constructor(
    readonly motions: Motions<I>,
    readonly list: readonly I[],
    /** The voice's numbers as the runner packed them, the first a place for its time. */
    readonly packed: Float32Array,
    /** Each registered subject's delay, in registration order; null where the voice does not stagger. */
    readonly delays: Float64Array | null = null,
  ) {
    this.vals = packed;
    this.watch();
    this.numbering = this.number();
  }

  /** Takes the patch's one watch, from a mirror on another mix that may never let it go. */
  private watch(): void {
    this.motions.watch(null);
    this.motions.watch(this.listen);
  }

  /** Matches every registered subject to its number, and sets every row to be written. */
  private number(): Numbering<I> {
    const m = this.motions;
    const numbering = new Numbering(m, this.list);
    this.numbering = numbering;
    this.due = new Set();
    for (const s of numbering.slots)
      if (s >= 0 && this.flags(s) & (PENDING | OLDER)) this.due.add(s);
    this.stride = m.stride;
    this.rows = new Float32Array(this.list.length * this.stride);
    this.touched.clear();
    this.rewrite = true;
    this.all = true;
    return numbering;
  }

  /** The voice time rows are written against; NaN until a frame shows the voice. */
  get anchor(): number {
    return this.anchors.anchor;
  }

  /**
   * Counts rows `from` to `to`'s release times from the current anchor, and marks them so. Only
   * those numbers move, so the rest of each row stands; a row whose subject has a change this
   * frame is written in full after.
   */
  private shift(from: number, to: number): void {
    const { rows, stride, anchors, numbering } = this;
    const anchor = anchors.anchor;
    for (let row = from, o = from * stride; row < to; row++, o += stride) {
      const at = numbering.releaseAt(row);
      if (at !== undefined) rows[o] = at - anchor;
      rows[o + 1] = anchors.mark(rows[o + 1] as number);
    }
  }

  /** Lets go of the number of each touched subject's row where the patch gave it up or to another. */
  private recheck(): void {
    for (const s of this.touched) {
      const row = this.numbering.recheck(s);
      if (row === undefined) continue;
      this.due.delete(s);
      this.dirty.add(row);
    }
  }

  private flags(s: number): number {
    return this.motions.runs[this.motions.base(s) + 1] as number;
  }

  private rowFor(s: number): number | undefined {
    return this.numbering.rowFor(s);
  }

  /**
   * Whether a run changed since the last `prepare`, so the fold made then is out of date. A mirror
   * whose watch another took cannot hear changes, so it counts as stirred until it takes it back.
   */
  get stirred(): boolean {
    return this.touched.size > 0 || (!this.detached && this.motions.listener !== this.listen);
  }

  /** The rows that will be written next, in order. */
  dirtyRows(): number[] {
    if (this.all) return Array.from(this.list, (_, i) => i);
    const rows = new Set(this.dirty);
    if (this.moved !== null)
      for (let row = this.moved[0]; row < this.moved[1]; row++) rows.add(row);
    for (const s of this.touched) {
      const row = this.rowFor(s);
      if (row !== undefined) rows.add(row);
    }
    return [...rows].sort((a, b) => a - b);
  }

  /**
   * Commits each registered subject's changes due by voice time `t`, letting go of stretches
   * older than `horizon`, as a live sample at `t` does, and writes the rows that changed. A change
   * timed later waits on `due` for the frame it falls due in. With `delays`, `t` and `horizon` are
   * at delay 0 and each row's are its delay less; a row before its start commits nothing, or
   * commits at 0 where `holds`, as a sample of a voice holding its first frame does. A row
   * `unread` says the CPU would not sample this frame, unreached or silent, commits nothing.
   */
  prepare(
    t: number,
    horizon: number,
    opts: { holds?: boolean; unread?: (row: number) => boolean } = {},
  ): void {
    const { holds = false, unread } = opts;
    const m = this.motions;
    if (m.listener !== this.listen) {
      warnOnce(m, SHARED);
      this.watch();
      this.number();
    } else this.recheck();
    const step = this.anchors.step(t, this.list.length);
    if (step === 'all') {
      this.all = true;
      if (!this.rewrite) this.shift(0, this.list.length);
    } else if (step !== null && !this.rewrite) {
      this.shift(step[0], step[1]);
      const m = this.moved;
      this.moved = m === null ? step : [Math.min(m[0], step[0]), Math.max(m[1], step[1])];
    }
    const work = new Set([...this.touched, ...this.due]);
    this.touched.clear();
    if (!Number.isNaN(t) && reading.live) {
      const was = reading.horizon;
      reading.horizon = horizon;
      try {
        for (const s of work) {
          const row = this.rowFor(s);
          if (row === undefined) continue;
          const at = this.at(row, t, holds);
          if (Number.isNaN(at) || unread?.(row)) continue;
          reading.horizon = horizon - (this.delays?.[row] ?? 0);
          m.advance(s, at);
        }
      } finally {
        reading.horizon = was;
      }
    }
    for (const s of this.touched) work.add(s);
    this.touched.clear();
    this.due = new Set();
    for (const s of work) {
      const row = this.rowFor(s);
      if (row === undefined) continue;
      this.dirty.add(row);
      if (this.flags(s) & (PENDING | OLDER)) this.due.add(s);
    }
    if (this.rewrite) {
      for (let row = 0; row < this.list.length; row++) this.write(row, this.at(row, t, holds));
      this.rewrite = false;
    } else for (const row of this.dirty) this.write(row, this.at(row, t, holds));
    const times = this.anchors.times(t);
    if (!Object.is(times[0], this.times[0]) || !Object.is(times[1], this.times[1])) {
      this.times = times;
      this.vals = this.packed.slice();
      this.vals[0] = times[0];
      this.vals[this.packed.length - 1] = times[1];
    }
  }

  /** Row `row`'s time at voice time `t`; NaN before its start, or 0 there where `holds`. */
  private at(row: number, t: number, holds: boolean): number {
    const d = this.delays;
    if (d === null) return t;
    const x = t - (d[row] as number);
    return x >= 0 || Number.isNaN(x) ? x : holds ? 0 : Number.NaN;
  }

  /** The voice's numbers this frame, its time counted from each anchor, first and last; a new array when it moved. */
  values(): Float32Array {
    return this.vals;
  }

  private write(row: number, t: number): void {
    const m = this.motions;
    const s = this.numbering.slots[row] as number;
    if (s < 0) {
      const u = this.numbering.unmetAt(row);
      this.put(row, u.flags, u.seg);
      return;
    }
    const b = m.base(s);
    const runs = m.runs;
    const flags = runs[b + 1] as number;
    // An earlier stretch plays at `t`, as after a seek back with history kept.
    if ((flags & OLDER) !== 0 && t < (runs[b] as number)) this.put(row, flags, m.playing(s, t));
    else this.put(row, flags, m.latest(s));
  }

  private put(row: number, flags: number, seg: Segment): void {
    const anchors = this.anchors;
    putRun(this.rows, row * this.stride, this.motions, anchors.mark(flags), seg, anchors.anchor);
  }

  /** The rows written since the last call, as sorted `[start, end)` byte ranges, touching ones joined. */
  take(): [number, number][] {
    const moved = this.moved;
    this.moved = null;
    if (this.all) {
      this.all = false;
      this.dirty.clear();
      return this.rows.length > 0 ? [[0, this.rows.byteLength]] : [];
    }
    const bytes = this.stride * 4;
    const out = rangesOf(this.dirty, bytes);
    this.dirty.clear();
    return moved === null ? out : spliced(out, moved[0] * bytes, moved[1] * bytes);
  }

  /** Stops listening to the patch. */
  detach(): void {
    this.detached = true;
    if (this.motions.listener === this.listen) this.motions.watch(null);
  }
}
