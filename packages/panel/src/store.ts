import type { Sample } from './protocol.js';

/** How much the plots keep: this much mix time, and never more frames than `cap`. */
export const WINDOW_MS = 10_000;
export const CAP = 1200;
/** How far past now the axis always runs, ms of mix time, and how far a mark ahead can stretch it. */
export const AHEAD_MS = 2_000;
export const AHEAD_CAP_MS = 30_000;

/**
 * The picked subject's samples, by mix time. A sample at the time of the last replaces it, as the
 * frames of a paused mix do; one behind it drops everything after it, as a seek back does.
 */
export class Samples {
  private list: Sample[] = [];

  constructor(
    private readonly windowMs = WINDOW_MS,
    private readonly cap = CAP,
  ) {}

  get length(): number {
    return this.list.length;
  }

  reset(): void {
    this.list = [];
  }

  push(s: Sample): void {
    const list = this.list;
    const last = list[list.length - 1];
    if (last !== undefined && s.now <= last.now) {
      let i = list.length;
      while (i > 0 && (list[i - 1] as Sample).now >= s.now) i--;
      list.length = i;
    }
    list.push(s);
    let drop = 0;
    while (drop < list.length && (list[drop] as Sample).now < s.now - this.windowMs) drop++;
    drop = Math.max(drop, list.length - this.cap);
    if (drop > 0) list.splice(0, drop);
  }

  /** The times, and each key's values in the same order, NaN where a sample lacks the key. */
  series(): {
    times: number[];
    values: Map<string, number[]>;
    weights: Map<number, number[]>;
    read: boolean[];
  } {
    const times = this.list.map((s) => s.now);
    const values = new Map<string, number[]>();
    const weights = new Map<number, number[]>();
    this.list.forEach((s, i) => {
      for (const [k, v] of Object.entries(s.values)) {
        let col = values.get(k);
        if (col === undefined) {
          col = new Array(times.length).fill(Number.NaN);
          values.set(k, col);
        }
        col[i] = v;
      }
      for (const [k, v] of Object.entries(s.weights)) {
        const id = Number(k);
        let col = weights.get(id);
        if (col === undefined) {
          col = new Array(times.length).fill(Number.NaN);
          weights.set(id, col);
        }
        col[i] = v;
      }
    });
    return { times, values, weights, read: this.list.map((s) => s.read) };
  }
}
