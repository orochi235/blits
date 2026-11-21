import { describe, expect, it } from 'vitest';
import { curve, curveData } from '../src/easing.js';

describe('curveData', () => {
  it('packs a named bezier as its four numbers', () => {
    expect(curveData(curve('ease-out'))).toEqual([1, 0, 0, 0.58, 1]);
    expect(curveData(curve('ease'))).toEqual([1, 0.25, 0.1, 0.25, 1]);
  });
  it('packs a custom bezier', () => {
    expect(curveData(curve({ bezier: [0.1, 0.2, 0.3, 0.4] }))).toEqual([1, 0.1, 0.2, 0.3, 0.4]);
  });
  it('packs steps with count and jump', () => {
    expect(curveData(curve({ steps: 4, jump: 'start' }))).toEqual([2, 4, 1, 0, 0]);
    expect(curveData(curve({ steps: 3 }))).toEqual([2, 3, 0, 0, 0]);
  });
  it('packs none and linear as zeros', () => {
    expect(curveData(curve('linear'))).toEqual([0, 0, 0, 0, 0]);
    expect(curveData(undefined)).toEqual([0, 0, 0, 0, 0]);
  });
  it('has no data for a plain function', () => {
    expect(curveData((u) => u * u)).toBeUndefined();
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
