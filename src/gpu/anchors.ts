/**
 * How far, in voice ms, the voice's time may move from the anchor rows are written against
 * before they start moving to a new one.
 */
export const DRIFT = 2 ** 14;

/** Past this from an anchor some row still counts from, every row moves at once: f32 keeps times to 1/512 ms below it. */
const FAR = 2 ** 15;

/** The bit in a row's flags word saying it counts from the second anchor. */
export const SECOND = 2 ** 20;

/** Rows moved a frame while two anchors are in use, at least: all of them within 64 frames. */
let least = 4096;

/** Sets how many rows a frame moves to a new anchor, at least, giving back the last; for tests that need rows on both. */
export function setLeast(rows: number): number {
  const was = least;
  least = rows;
  return was;
}

/**
 * A mirror's two anchors, the voice times its rows' release times count from. Rows are written
 * against `cur`; when the voice's time drifts past `DRIFT` from it, `cur` switches to the other
 * anchor, set at that time, and rows move to it a share each frame, so no frame writes every row.
 */
export class Anchors {
  /** Each anchor, voice ms; NaN for one no row counts from. */
  readonly at: [number, number] = [Number.NaN, Number.NaN];
  /** The anchor rows are written against. */
  cur: 0 | 1 = 0;
  /** While rows move to `cur`, the first row not yet moved; -1 when none are moving. */
  private next = -1;

  /** The anchor rows are written against, voice ms. */
  get anchor(): number {
    return this.at[this.cur];
  }

  /**
   * What a frame at voice time `t` over `n` rows must do: `'all'` to count every row from `cur`,
   * set to `t`, now; `[from, to)` rows to move to `cur`; or null for nothing.
   */
  step(t: number, n: number): 'all' | [number, number] | null {
    if (Number.isNaN(t)) return null;
    const a = this.at[this.cur];
    const old = this.at[1 - this.cur] as number;
    const moving = this.next >= 0;
    if (!(Math.abs(t - a) < FAR) || (moving && !(Math.abs(t - old) < FAR))) {
      this.at[this.cur] = t;
      this.at[1 - this.cur] = Number.NaN;
      this.next = -1;
      return 'all';
    }
    if (!moving) {
      if (Math.abs(t - a) <= DRIFT) return null;
      this.cur = this.cur === 0 ? 1 : 0;
      this.at[this.cur] = t;
      this.next = 0;
    }
    const from = this.next;
    const to = Math.min(n, from + Math.max(least, Math.ceil(n / 64)));
    this.next = to >= n ? -1 : to;
    if (this.next < 0) this.at[1 - this.cur] = Number.NaN;
    return [from, to];
  }

  /** `t` counted from each anchor, 0 for one no row counts from. */
  times(t: number): [number, number] {
    const [a, b] = this.at;
    return [Number.isNaN(a) ? 0 : t - a, Number.isNaN(b) ? 0 : t - b];
  }

  /** `word`, a row's flags, marked as counting from `cur`. */
  mark(word: number): number {
    const w = word | 0;
    return this.cur === 1 ? w | SECOND : w & ~SECOND;
  }
}
