import { describe, expect, it } from 'vitest';
import { Grid } from '../src/grid.js';

function grid(xy: number[]): Grid {
  const g = new Grid();
  g.xy = new Float64Array(xy);
  g.n = xy.length / 2;
  return g;
}

describe('Grid', () => {
  it('finds finite places beside a place at an infinity, as beside one at NaN', () => {
    for (const bad of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      const g = grid([0, 0, bad, 1]);
      expect(g.query(0, 0, 0, 1, 1)).toBe(1);
      expect(g.found[0]).toBe(0);
      expect(Number.isFinite(g.cols)).toBe(true);
    }
  });

  it('finds no one where a place is put at an infinity', () => {
    const g = grid([0, 0, 2, 2]);
    expect(g.query(0, 0, 0, 1, 1)).toBe(1);
    g.put(1, Number.POSITIVE_INFINITY, 0, 0);
    expect(g.query(0, 0, 0, 1, 1)).toBe(1);
    expect(g.ring(0, 0, 0, 1)).toBe(0);
  });
});
