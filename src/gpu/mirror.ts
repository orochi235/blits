import type { Motions } from '../motions.js';
import { reading } from '../reading.js';
import { RunFlag } from '../stretch.js';

const PENDING = RunFlag.PENDING;
const OLDER = RunFlag.OLDER;

/**
 * How far, in voice ms, the voice's time may move from `anchor` before every row is written again
 * from a new one: f32 keeps times there to 1/512 ms.
 */
const DRIFT = 2 ** 14;

/**
 * A motion voice's runs as the GPU reads them: each registered subject's run, in registration
 * order, kept in step with its `Motions` by `watch`. Before each dispatch, `prepare` commits the
 * changes due by the voice's time, as a live `sample` would, since a host reading only the GPU's
 * buffers makes none; `take` then hands over the rows that changed.
 */
export class Mirror<I> {
  /** Each registered subject's run, `stride` numbers apiece, its release time counted from `anchor`. */
  rows = new Float32Array(0);
  stride = 0;
  /** The voice time the rows' times count from; NaN until a frame shows the voice. */
  anchor = Number.NaN;
  /** By row, the subject's number in `motions`. */
  private slots = new Int32Array(0);
  /** By subject number, its row; undefined for a subject not registered. */
  private rowOf: (number | undefined)[] = [];
  /** `motions.freed` when the rows were numbered: a number given up since may now be another's. */
  private freed = 0;
  /** Subject numbers whose run or pending changes moved since the last `prepare`. */
  private touched = new Set<number>();
  /** Subject numbers with a change still to come or an earlier stretch kept, met every frame. */
  private due = new Set<number>();
  /** Rows written since the last `take`. */
  private dirty = new Set<number>();
  private time = Number.NaN;
  private vals: Float32Array;
  private readonly listen = (s: number) => {
    this.touched.add(s);
  };

  constructor(
    readonly motions: Motions<I>,
    readonly list: readonly I[],
    /** The voice's numbers as the runner packed them, the first a place for its time. */
    private readonly packed: Float32Array,
  ) {
    this.vals = packed;
    this.number();
    motions.watch(this.listen);
  }

  /** Numbers every registered subject, making a run for one the patch has not met, as a sample would. */
  private number(): void {
    const m = this.motions;
    this.slots = Int32Array.from(this.list, (s) => m.slot(s));
    this.freed = m.freed;
    this.rowOf = [];
    this.slots.forEach((s, i) => {
      this.rowOf[s] = i;
    });
    this.stride = m.stride;
    this.rows = new Float32Array(this.list.length * this.stride);
    this.due = new Set();
    for (const s of this.slots) if (this.flags(s) & (PENDING | OLDER)) this.due.add(s);
    this.touched.clear();
    this.every();
  }

  private every(): void {
    for (let i = 0; i < this.list.length; i++) this.dirty.add(i);
  }

  private flags(s: number): number {
    return this.motions.runs[this.motions.base(s) + 1] as number;
  }

  /** Whether a run changed since the last `prepare`, so the fold made then is out of date. */
  get stirred(): boolean {
    return this.touched.size > 0;
  }

  /** The rows that will be written next, in order. */
  dirtyRows(): number[] {
    const rows = new Set(this.dirty);
    for (const s of this.touched) {
      const row = this.rowOf[s];
      if (row !== undefined) rows.add(row);
    }
    return [...rows].sort((a, b) => a - b);
  }

  /**
   * Commits each registered subject's changes due by voice time `t`, letting go of stretches
   * older than `horizon`, as a live sample at `t` does, and writes the rows that changed. A change
   * timed later waits on `due` for the frame it falls due in.
   */
  prepare(t: number, horizon: number): void {
    const m = this.motions;
    if (m.freed !== this.freed) this.number();
    if (!Number.isNaN(t) && !(Math.abs(t - this.anchor) <= DRIFT)) {
      this.anchor = t;
      this.every();
    }
    const work = new Set([...this.touched, ...this.due]);
    this.touched.clear();
    if (!Number.isNaN(t) && reading.live) {
      const was = reading.horizon;
      reading.horizon = horizon;
      try {
        for (const s of work) if (this.rowOf[s] !== undefined) m.advance(s, t);
      } finally {
        reading.horizon = was;
      }
    }
    for (const s of this.touched) work.add(s);
    this.touched.clear();
    this.due = new Set();
    for (const s of work) {
      const row = this.rowOf[s];
      if (row === undefined) continue;
      this.dirty.add(row);
      if (this.flags(s) & (PENDING | OLDER)) this.due.add(s);
    }
    for (const row of this.dirty) this.write(row, t);
    if (!Object.is(t - this.anchor, this.time)) {
      this.time = t - this.anchor;
      this.vals = this.packed.slice();
      this.vals[0] = this.time;
    }
  }

  /** The voice's numbers this frame, its time counted from `anchor`; a new array when it moved. */
  values(): Float32Array {
    return this.vals;
  }

  private write(row: number, t: number): void {
    const m = this.motions;
    const s = this.slots[row] as number;
    const b = m.base(s);
    const runs = m.runs;
    const o = row * this.stride;
    const rows = this.rows;
    if ((this.flags(s) & OLDER) !== 0 && t < (runs[b] as number)) {
      // An earlier stretch plays at `t`, as after a seek back with history kept.
      const seg = m.playing(s, t);
      const n = m.n;
      rows[o] = seg.at - this.anchor;
      rows[o + 1] = runs[b + 1] as number;
      rows[o + 2] = seg.ms;
      for (let i = 0; i < n; i++) {
        rows[o + 3 + i] = seg.x0[i] as number;
        rows[o + 3 + n + i] = seg.v0[i] as number;
        rows[o + 3 + 2 * n + i] = seg.to[i] as number;
      }
      return;
    }
    for (let j = 0; j < this.stride; j++) rows[o + j] = runs[b + j] as number;
    rows[o] = (runs[b] as number) - this.anchor;
  }

  /** The rows written since the last call, as sorted `[start, end)` byte ranges, touching ones joined. */
  take(): [number, number][] {
    const out: [number, number][] = [];
    const bytes = this.stride * 4;
    for (const row of [...this.dirty].sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      if (last !== undefined && last[1] === row * bytes) last[1] += bytes;
      else out.push([row * bytes, (row + 1) * bytes]);
    }
    this.dirty.clear();
    return out;
  }

  /** Stops listening to the patch. */
  detach(): void {
    if (this.motions.listener === this.listen) this.motions.watch(null);
  }
}
