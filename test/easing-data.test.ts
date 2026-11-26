import { describe, expect, it } from 'vitest';
import { curve, curveData } from '../src/easing.js';
import type { Easing } from '../src/index.js';

describe('curveData', () => {
  it('packs a named bezier as its four numbers', () => {
    expect(curveData(curve('ease-out'))).toEqual([1, 0, 0, 0.58, 1]);
    expect(curveData(curve('ease'))).toEqual([1, 0.25, 0.1, 0.25, 1]);
  });
  it('packs a custom bezier', () => {
    expect(curveData(curve({ bezier: [0.1, 0.2, 0.3, 0.4] }))).toEqual([1, 0.1, 0.2, 0.3, 0.4]);
  });
  it('packs steps with count, the step taken at 0, and the jumps past the count', () => {
    expect(curveData(curve({ steps: 4, jump: 'start' }))).toEqual([2, 4, 1, 0, 0]);
    expect(curveData(curve({ steps: 3 }))).toEqual([2, 3, 0, 0, 0]);
    expect(curveData(curve({ steps: 3, jump: 'both' }))).toEqual([2, 3, 1, 1, 0]);
    expect(curveData(curve({ steps: 3, jump: 'none' }))).toEqual([2, 3, 0, -1, 0]);
  });
  it('packs linear as a head pointing just past itself, then its points', () => {
    expect(curveData(curve({ linear: [0, [0.25, 0.75], 1] }))).toEqual([
      3, 5, 3, 0, 0, 0, 0, 0.75, 0.25, 1, 1,
    ]);
  });
  it('packs none and linear as zeros', () => {
    expect(curveData(curve('linear'))).toEqual([0, 0, 0, 0, 0]);
    expect(curveData(undefined)).toEqual([0, 0, 0, 0, 0]);
  });
  it('has no data for a plain function', () => {
    expect(curveData((u) => u * u)).toBeUndefined();
  });
});

describe('steps', () => {
  const at = (e: Easing, us: number[]) => us.map(curve(e));
  it('jump-none takes no jump at either end', () => {
    expect(at({ steps: 2, jump: 'none' }, [0, 0.49, 0.5, 0.99, 1])).toEqual([0, 0, 1, 1, 1]);
  });
  it('jump-both jumps at both ends', () => {
    expect(at({ steps: 2, jump: 'both' }, [0, 0.49, 0.5, 1])).toEqual([1 / 3, 1 / 3, 2 / 3, 1]);
  });
  it('refuses jump-none with fewer than two steps', () => {
    expect(() => curve({ steps: 1, jump: 'none' })).toThrow(RangeError);
  });
});

describe('linear', () => {
  const at = (e: Easing, u: number) => curve(e)(u);
  it('spreads points with no input evenly', () => {
    expect(at({ linear: [0, 0.25, 1] }, 0.25)).toBeCloseTo(0.125);
    expect(at({ linear: [0, 0.25, 1] }, 0.75)).toBeCloseTo(0.625);
    const run = curve({ linear: [0, 0.1, 0.2, [0.3, 0.9], 1] });
    expect([0.3, 0.6, 0.9].map(run)).toEqual([0.1, 0.2, 0.3].map((y) => expect.closeTo(y)));
  });
  it('places a point at its input, and holds one over two', () => {
    expect(at({ linear: [0, [0.25, 0.75], 1] }, 0.5)).toBeCloseTo(0.25 * (0.5 / 0.75));
    expect(at({ linear: [0, [0.25, 0.25, 0.75], 1] }, 0.5)).toBe(0.25);
  });
  it('moves an input behind an earlier one up to it, and jumps there', () => {
    const c = curve({ linear: [0, [0.5, 0.6], [0.25, 0.4], 1] });
    expect(c(0.6)).toBe(0.25);
    expect(c(0.5)).toBeCloseTo(0.5 * (0.5 / 0.6));
    expect(c(0.8)).toBeCloseTo(0.625);
  });
  it('carries the first and last lines on past the ends', () => {
    expect(at({ linear: [0, 1] }, -0.5)).toBe(-0.5);
    expect(at({ linear: [0, 1] }, 1.5)).toBe(1.5);
    expect(
      at(
        {
          linear: [
            [0, 0.2],
            [1, 0.8],
          ],
        },
        0.1,
      ),
    ).toBeCloseTo(-1 / 6);
  });
  it('refuses one point, a number that is not finite, and three inputs', () => {
    expect(() => curve({ linear: [0] })).toThrow(RangeError);
    expect(() => curve({ linear: [0, Number.NaN] })).toThrow(RangeError);
    expect(() => curve({ linear: [0, [1, 0.1, 0.2, 0.3] as never] })).toThrow(RangeError);
  });
  it('gives the same function for the same easing object', () => {
    const e: Easing = { linear: [0, 1] };
    expect(curve(e)).toBe(curve(e));
  });
});

describe('curve', () => {
  it('refuses a step count that is not a whole number of 1 or more', () => {
    for (const steps of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => curve({ steps })).toThrow(RangeError);
  });
  it('refuses a bezier whose x is outside 0..1, or any number that is not finite', () => {
    for (const b of [
      [-0.1, 0, 0.5, 1],
      [0.5, 0, 1.2, 1],
      [0.5, Number.NaN, 0.5, 1],
      [0.5, 0, 0.5, Number.POSITIVE_INFINITY],
    ] as const)
      expect(() => curve({ bezier: b })).toThrow(RangeError);
    expect(() => curve({ bezier: [0.3, -0.5, 0.7, 1.6] })).not.toThrow();
  });
});
