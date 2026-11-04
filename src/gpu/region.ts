/** One voice's packed values for this frame, and what owns the region they sit in. */
export interface Entry {
  readonly owner: object;
  readonly values: Float32Array;
}

/** Where each voice's values sit this frame, and the byte ranges written since the last. */
export interface Placement {
  /** Each entry's offset in f32s, in entry order. */
  readonly offsets: readonly number[];
  /** `[start, end)` in bytes, sorted, ranges that touch merged. */
  readonly changed: readonly (readonly [number, number])[];
}

interface Held {
  readonly values: Float32Array;
  readonly offset: number;
}

/**
 * The frame's voices' packed values in one array, each in a region that keeps its offset while its
 * values are unchanged, so the GPU's copy needs writing only where a voice came or changed.
 */
export class Regions {
  private held = new Map<object, Held>();
  private store = new Float32Array(16);
  private end = 0;

  /** The values, as far as `length`. */
  get data(): Float32Array {
    return this.store;
  }

  /** How many f32s of `data` are in use. */
  get length(): number {
    return this.end;
  }

  frame(entries: readonly Entry[]): Placement {
    const live = entries.reduce((n, e) => n + e.values.length, 0);
    // Holes left by departed or resized voices are dropped once they outweigh the live values.
    if (this.end > 2 * live + 64) return this.compact(entries);
    const next = new Map<object, Held>();
    const offsets: number[] = [];
    const changed: [number, number][] = [];
    for (const e of entries) {
      const had = this.held.get(e.owner);
      let offset: number;
      if (had !== undefined && had.values === e.values) offset = had.offset;
      else {
        offset =
          had !== undefined && had.values.length >= e.values.length ? had.offset : this.grow(e);
        this.store.set(e.values, offset);
        changed.push([offset, offset + e.values.length]);
      }
      next.set(e.owner, { values: e.values, offset });
      offsets.push(offset);
    }
    this.held = next;
    return { offsets, changed: merged(changed) };
  }

  /** Lays every entry end to end afresh, all of it changed. */
  private compact(entries: readonly Entry[]): Placement {
    this.held = new Map();
    this.end = 0;
    const offsets = entries.map((e) => {
      const offset = this.grow(e);
      this.store.set(e.values, offset);
      this.held.set(e.owner, { values: e.values, offset });
      return offset;
    });
    return { offsets, changed: merged([[0, this.end]]) };
  }

  /** Room for `e`'s values past the end, the store doubled where it is too small. */
  private grow(e: Entry): number {
    const at = this.end;
    this.end += e.values.length;
    if (this.end > this.store.length) {
      const bigger = new Float32Array(2 ** Math.ceil(Math.log2(this.end)));
      bigger.set(this.store);
      this.store = bigger;
    }
    return at;
  }
}

/** Ranges in f32s as sorted byte ranges, the empty ones dropped and touching ones joined. */
function merged(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last !== undefined && last[1] >= a * 4) last[1] = Math.max(last[1], b * 4);
    else out.push([a * 4, b * 4]);
  }
  return out;
}
