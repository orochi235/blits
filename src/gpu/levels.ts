/** Past this many distinct delays, each subject is its own level. */
export const MOST = 4096;
const SLOTS = MOST * 2;
const SHIFT = 32 - Math.log2(SLOTS);

const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);

/** A list of delays as its distinct values and each one's index into them. */
export interface Levels {
  /** Each distinct delay, in order of first appearance; the delays themselves where `codes` is null. */
  readonly values: Float64Array;
  /** Each subject's index into `values`; null where there were more than `MOST`, each its own. */
  readonly codes: Uint16Array | null;
}

/** Per delays array, its levels: an answer's delays are never written, and a voice naming every subject keeps one across seeks. */
const known = new WeakMap<Float64Array, Levels>();

/**
 * `delays` by distinct value, as a stagger over many subjects usually has few: worked out by
 * hashing each delay's bits once, with no per-subject `Map` lookup.
 */
export function levelsOf(delays: Float64Array): Levels {
  let levels = known.get(delays);
  if (levels === undefined) {
    levels = distinct(delays);
    known.set(delays, levels);
  }
  return levels;
}

function distinct(delays: Float64Array): Levels {
  const n = delays.length;
  const codes = new Uint16Array(n);
  const values = new Float64Array(MOST);
  // Each slot holds a level + 1; 0 for empty.
  const slots = new Uint16Array(SLOTS);
  let size = 0;
  for (let i = 0; i < n; i++) {
    const d = delays[i] as number;
    bits[0] = d;
    let h = Math.imul((words[0] as number) ^ (words[1] as number), 0x9e3779b1) >>> SHIFT;
    let level: number;
    for (;;) {
      const s = slots[h] as number;
      if (s === 0) {
        if (size === MOST) return each(delays);
        level = size++;
        values[level] = d;
        slots[h] = size;
        break;
      }
      if (values[s - 1] === d) {
        level = s - 1;
        break;
      }
      h = (h + 1) & (SLOTS - 1);
    }
    codes[i] = level;
  }
  return { values: values.subarray(0, size), codes };
}

function each(delays: Float64Array): Levels {
  return { values: delays, codes: null };
}
