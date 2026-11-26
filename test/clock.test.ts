import { describe, expect, it } from 'vitest';
import {
  type Clock,
  clampWeight,
  passAt,
  passesOf,
  phaseAt,
  rateWith,
  rebaseWith,
} from '../src/clock.js';

describe('clock', () => {
  it('counts passes from a loop', () => {
    expect(passesOf(undefined)).toBe(1);
    expect(passesOf(true)).toBe(Number.POSITIVE_INFINITY);
    expect(passesOf(false)).toBe(1);
    expect(passesOf(3)).toBe(3);
  });

  it('places elapsed time within a pass, and holds phase 1 once the passes are done', () => {
    const at = (e: number, duration: number, passes: number) => ({
      phase: phaseAt(e, duration, passes),
      pass: passAt(e, duration, passes),
    });
    expect(at(250, 1000, Number.POSITIVE_INFINITY)).toEqual({ phase: 0.25, pass: 0 });
    expect(at(2250, 1000, Number.POSITIVE_INFINITY)).toEqual({ phase: 0.25, pass: 2 });
    expect(at(2250, 1000, 2)).toEqual({ phase: 1, pass: 1 });
    expect(at(500, 0, 1)).toEqual({ phase: 0, pass: 0 });
  });

  it('clamps a weight to 0..1', () => {
    expect(clampWeight(-0.5)).toBe(0);
    expect(clampWeight(0.4)).toBe(0.4);
    expect(clampWeight(1.7)).toBe(1);
  });

  it('reaches the target of a ramp at its end, where host time far from 0 lands a few ulps short', () => {
    const anchorNow = 1e7 + 0.1;
    const c: Clock = {
      anchorNow,
      anchorElapsed: 0,
      rate: 2.3,
      ramp: { from: 1, to: 2.3, over: 100 },
    };
    const end = anchorNow + 100;
    const short = end - 2 * Number.EPSILON * end;
    expect(short).toBeLessThan(end);
    expect(rateWith(c, short)).toBe(2.3);
    rebaseWith(c, short);
    expect(c.ramp).toBeNull();
    expect(rateWith(c, short + 1)).toBe(2.3);
  });
});
