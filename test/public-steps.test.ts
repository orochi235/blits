import { describe, expect, it } from 'vitest';
import { passAt, passesOf, phaseAt, slewStep } from '../src/index.js';

describe('the pass math, from the public entry', () => {
  it('counts passes and places time within one', () => {
    expect(passesOf(true)).toBe(Number.POSITIVE_INFINITY);
    expect(passesOf(3)).toBe(3);
    expect(phaseAt(2250, 1000, 3)).toBe(0.25);
    expect(passAt(2250, 1000, 3)).toBe(2);
    expect(phaseAt(5000, 1000, 3)).toBe(1);
  });

  it('ends a fraction of a pass partway through its last pass', () => {
    expect(passAt(9000, 1000, 2.5)).toBe(2);
    expect(phaseAt(9000, 1000, 2.5)).toBe(0.5);
    expect(passAt(900, 1000, 0.5)).toBe(0);
    expect(phaseAt(900, 1000, 0.5)).toBe(0.5);
  });

  it('settles the pass against the product the phase is measured from', () => {
    const pass = passAt(50, 0.1, Number.POSITIVE_INFINITY);
    const phase = phaseAt(50, 0.1, Number.POSITIVE_INFINITY);
    expect(pass * 0.1 + phase * 0.1).toBeCloseTo(50, 9);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
  });

  it('reads a pass line as the end of the pass before, given edge', () => {
    expect([passAt(2000, 1000, 3), phaseAt(2000, 1000, 3)]).toEqual([2, 0]);
    expect([passAt(2000, 1000, 3, true), phaseAt(2000, 1000, 3, true)]).toEqual([1, 1]);
    expect([passAt(0, 1000, 3, true), phaseAt(0, 1000, 3, true)]).toEqual([0, 0]);
  });

  it('reads that end as phase 1 exactly, where the product rounds a few ulps off the line', () => {
    expect(phaseAt(150, 0.1, Number.POSITIVE_INFINITY, true)).toBe(1);
    expect(phaseAt(2048.156150749791, 682.718716916597, Number.POSITIVE_INFINITY, true)).toBe(1);
  });

  it('places time before 0 in the passes before, at a phase from 0 to 1', () => {
    expect([
      passAt(-250, 1000, Number.POSITIVE_INFINITY),
      phaseAt(-250, 1000, Number.POSITIVE_INFINITY),
    ]).toEqual([-1, 0.75]);
  });
});

describe('slewStep', () => {
  it('moves no faster than its rise and fall, and stops on the target', () => {
    expect(slewStep(0, 1, 50, { riseMs: 100 })).toBe(0.5);
    expect(slewStep(0, 1, 500, { riseMs: 100 })).toBe(1);
    expect(slewStep(1, 0, 25, { fallMs: 100 })).toBe(0.75);
    expect(slewStep(1, 0, 25, { riseMs: 100 })).toBe(0);
    expect(slewStep(0.2, 0.2, 10, { riseMs: 100, fallMs: 100 })).toBe(0.2);
  });
});
