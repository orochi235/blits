import { describe, expect, it } from 'vitest';
import { levelsOf, MOST } from '../src/gpu/levels.js';

const expand = (l: ReturnType<typeof levelsOf>, n: number) =>
  Array.from({ length: n }, (_, i) => l.values[l.codes === null ? i : (l.codes[i] as number)]);

describe('levelsOf', () => {
  it('gives each distinct delay one level, in order of first appearance', () => {
    const delays = Float64Array.from({ length: 1000 }, (_, i) => (i % 7) * 0.25);
    const l = levelsOf(delays);
    expect([...l.values]).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
    expect(expand(l, 1000)).toEqual([...delays]);
  });

  it('keeps every delay its own level past MOST distinct ones', () => {
    const delays = Float64Array.from({ length: MOST + 1 }, (_, i) => i);
    const l = levelsOf(delays);
    expect(l.codes).toBeNull();
    expect(l.values).toBe(delays);
  });

  it('holds extremes, infinities, the smallest subnormal, and -0', () => {
    const odd = [0, -0, 1e300, -1e300, Number.POSITIVE_INFINITY, 2 ** -1074, 3, 3];
    const delays = Float64Array.from({ length: 4000 }, (_, i) => odd[i % odd.length] as number);
    const l = levelsOf(delays);
    expect(l.codes).not.toBeNull();
    expect(expand(l, 4000)).toEqual([...delays]);
  });

  it('falls back where NaN delays outnumber the levels, rather than looping', () => {
    const delays = new Float64Array(MOST + 10).fill(Number.NaN);
    expect(levelsOf(delays).codes).toBeNull();
  });

  it('works out one array of delays once', () => {
    const delays = Float64Array.from({ length: 100 }, (_, i) => i % 3);
    expect(levelsOf(delays)).toBe(levelsOf(delays));
  });
});
