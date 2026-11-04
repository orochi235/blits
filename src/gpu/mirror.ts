import { BOUND } from '../closed.js';
import type { Motions } from '../motions.js';
import { absent } from '../numbers.js';
import { reading } from '../reading.js';
import { RunFlag, type Segment } from '../stretch.js';
import { BRANCH_SHIFT, Branch } from './wgsl/closed.js';

const PENDING = RunFlag.PENDING;
const OLDER = RunFlag.OLDER;

/**
 * How far, in voice ms, the voice's time may move from `anchor` before every row is written again
 * from a new one: f32 keeps times there to 1/512 ms.
 */
const DRIFT = 2 ** 14;

/**
 * A motion voice's runs as the GPU reads them: each registered subject's run, in registration
 * order, kept in step with its `Motions` by `watch`. A subject the patch has not met yet gets the
 * row its first stretch would have, without the patch numbering it: registering is not meeting.
 * Before each dispatch, `prepare` commits the changes due by the voice's time, as a live `sample`
 * would, since a host reading only the GPU's buffers makes none; `take` then hands over the rows
 * that changed.
 */
export class Mirror<I> {
  /** Each registered subject's run, `stride` numbers apiece, its release time counted from `anchor`. */
  rows = new Float32Array(0);
  stride = 0;
  /** The voice time the rows' times count from; NaN until a frame shows the voice. */
  anchor = Number.NaN;
  /** By row, the subject's number in `motions`; -1 for one the patch has not met. */
  private slots = new Int32Array(0);
  /** By row, the first stretch of a subject the patch has not met, and its flags. */
  private unmet: ({ seg: Segment; flags: number } | undefined)[] = [];
  /** By subject number, its row; undefined for a number not yet matched to a registered subject. */
  private rowOf: (number | undefined)[] = [];
  private bySubject = new Map<I, number>();
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
    readonly packed: Float32Array,
  ) {
    this.vals = packed;
    motions.watch(this.listen);
    this.number();
  }

  /** Matches every registered subject to its number, working out the first row of one with none. */
  private number(): void {
    const m = this.motions;
    this.freed = m.freed;
    this.rowOf = [];
    this.bySubject = new Map();
    this.slots = new Int32Array(this.list.length).fill(-1);
    this.unmet = [];
    this.due = new Set();
    this.list.forEach((subject, i) => {
      this.bySubject.set(subject, i);
      const s = m.known(subject);
      if (s === undefined) {
        const run = m.freshRun(subject);
        this.unmet[i] = { seg: run.stretches[0] as Segment, flags: run.flags };
        return;
      }
      this.slots[i] = s;
      this.rowOf[s] = i;
      if (this.flags(s) & (PENDING | OLDER)) this.due.add(s);
    });
    this.stride = m.stride;
    this.rows = new Float32Array(this.list.length * this.stride);
    this.touched.clear();
    this.every();
  }

  private every(): void {
    for (let i = 0; i < this.list.length; i++) this.dirty.add(i);
  }

  private flags(s: number): number {
    return this.motions.runs[this.motions.base(s) + 1] as number;
  }

  /** Subject number `s`'s row, matching it to its registered subject the first time it is seen. */
  private rowFor(s: number): number | undefined {
    const known = this.rowOf[s];
    if (known !== undefined) return known;
    const subject = this.motions.numbers.subject(s);
    if (subject === absent) return undefined;
    const row = this.bySubject.get(subject);
    if (row === undefined) return undefined;
    this.slots[row] = s;
    this.rowOf[s] = row;
    this.unmet[row] = undefined;
    return row;
  }

  /** Whether a run changed since the last `prepare`, so the fold made then is out of date. */
  get stirred(): boolean {
    return this.touched.size > 0;
  }

  /** The rows that will be written next, in order. */
  dirtyRows(): number[] {
    const rows = new Set(this.dirty);
    for (const s of this.touched) {
      const row = this.rowFor(s);
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
        for (const s of work) if (this.rowFor(s) !== undefined) m.advance(s, t);
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
    if (s < 0) {
      const u = this.unmet[row] as { seg: Segment; flags: number };
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

  /**
   * Writes `seg` into `row`. A bounded glide's branch on each axis is decided here in f64, as the
   * CPU decides it, and carried in the flags word: f32 could take a different one.
   */
  private put(row: number, flags: number, seg: Segment): void {
    const n = this.motions.n;
    const law = this.motions.shape.law;
    const rows = this.rows;
    const o = row * this.stride;
    let word = flags;
    if (law[0] === BOUND) {
      const tau = law[2] as number;
      for (let i = 0; i < n; i++) {
        const x0 = seg.x0[i] as number;
        const goal = seg.to[i] as number;
        const y0 = x0 - goal;
        const over = x0 + (seg.v0[i] as number) * tau - goal;
        const branch = over === 0 ? Branch.COAST : y0 * over > 0 ? Branch.BACK : Branch.CROSS;
        word += branch * 2 ** (BRANCH_SHIFT + 2 * i);
      }
    }
    rows[o] = seg.at - this.anchor;
    rows[o + 1] = word;
    rows[o + 2] = seg.ms;
    for (let i = 0; i < n; i++) {
      rows[o + 3 + i] = seg.x0[i] as number;
      rows[o + 3 + n + i] = seg.v0[i] as number;
      rows[o + 3 + 2 * n + i] = seg.to[i] as number;
    }
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
