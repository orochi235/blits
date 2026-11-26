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
