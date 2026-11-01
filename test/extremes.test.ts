import { describe, expect, it } from 'vitest';
import { darken } from '../src/blend-modes.js';
import { kit } from '../src/channels.js';
import { min, norm } from '../src/extremes.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Channel } from '../src/types.js';

interface Pose {
  v: number;
}
const part = { id: 'a' };

/** The value `voices`, each a number and a weight, fold to under `v`, cued in order. */
function folded(v: Channel<number>, voices: [number, number][]): number | undefined {
  const m = mix<object, Pose>(kit<Pose>({ v }));
  for (const [value, weight] of voices)
    m.cue({ patch: patch<object, Pose>(0, () => ({ v: value }), { writes: ['v'] }), weight });
  m.sync(0);
  return m.probe(part).v;
}

describe('min', () => {
  it('takes the smallest contribution', () => {
    expect(
      folded(min(), [
        [0.7, 1],
        [0.4, 1],
        [0.9, 1],
      ]),
    ).toBe(0.4);
  });

  it('rests at its top bound, or at 1, and a weight fades toward it', () => {
    expect(folded(min({ bounds: [0, 400] }), [])).toBe(400);
    expect(folded(min(), [])).toBe(1);
    expect(folded(min({ bounds: [0, 10] }), [[2, 0.5]])).toBe(6);
  });

  it('folds as darken does on numbers, resting at 1', () => {
    const voices: [number, number][] = [
      [0.3, 0.5],
      [0.6, 1],
    ];
    expect(folded(min(), voices)).toBe(folded(darken(), voices));
  });

  it('names its bounds in its kind, and refuses a top it cannot rest at', () => {
    expect(min().kind).toBe('min');
    expect(min({ bounds: [0, 400] }).kind).toBe('min[0, 400]');
    expect(() => min({ bounds: [0, Number.POSITIVE_INFINITY] })).toThrow(/finite/);
  });
});

describe('norm', () => {
  it('gives one voice its own value', () => {
    expect(folded(norm(), [[0.8, 1]])).toBe(0.8);
    expect(folded(norm(), [])).toBe(0);
  });

  it('builds up between sum and max', () => {
    const two: [number, number][] = [
      [1, 1],
      [1, 1],
    ];
    expect(folded(norm(), two)).toBeCloseTo(Math.SQRT2, 12);
    expect(folded(norm({ power: 1 }), two)).toBe(2);
    expect(folded(norm({ power: 40 }), two)).toBeCloseTo(1, 1);
  });

  it('keeps each contribution sign, and scales one by its weight first', () => {
    expect(
      folded(norm(), [
        [3, 1],
        [-4, 1],
      ]),
    ).toBeCloseTo(-Math.sqrt(7), 12);
    expect(folded(norm(), [[0.8, 0.5]])).toBeCloseTo(0.4, 12);
  });

  it('names its power in its kind, and refuses one below 1', () => {
    expect(norm().kind).toBe('norm(2)');
    expect(norm({ power: 3, bounds: [0, 1] }).kind).toBe('norm(3)[0, 1]');
    expect(() => norm({ power: 0.5 })).toThrow(/at least 1/);
    expect(() => norm({ power: Number.POSITIVE_INFINITY })).toThrow(/finite/);
  });
});
