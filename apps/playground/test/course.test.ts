import { coursesOf } from '@pg/blits/course';
import { FRAME } from '@pg/blits/frame';
import { area, curve, spread, stops } from '@pg/widgets/ScoreLanes/track';
import { describe, expect, it } from 'vitest';
import { comp, group, subjects, voice } from './helpers';

const bob = voice({
  id: 'bob',
  owner: 'g',
  patch: {
    kind: 'keys',
    period: 500,
    stops: [
      { at: 0, delta: { offset: [0, 0], scale: 1 } },
      { at: 0.5, delta: { offset: [0, -20], scale: 1.1 } },
      { at: 1, delta: { offset: [0, 0], scale: 1 } },
    ],
  },
});
const warm = voice({
  id: 'warm',
  start: 500,
  patch: {
    kind: 'keys',
    period: 500,
    stops: [
      { at: 0, delta: { color: 0xff8f3f } },
      { at: 1, delta: { color: 0x3fa9ff } },
    ],
  },
});

describe('coursesOf', () => {
  const tracks = coursesOf(comp([bob, warm], [group({ id: 'g' })]), subjects, 0, 21);

  it('samples every voice and group n times across the length, each at its frame', () => {
    expect([...tracks.keys()].sort()).toEqual(['bob', 'g', 'warm']);
    for (const t of tracks.values()) {
      expect(t.weights).toHaveLength(21);
      expect(t.at).toHaveLength(21);
      expect(t.at[0]).toBe(0);
      for (const ms of t.at) expect(ms / FRAME).toBeCloseTo(Math.round(ms / FRAME), 9);
    }
  });

  it('reads each weight off what blits played', () => {
    expect(tracks.get('bob')?.weights.every((w) => w === 1)).toBe(true);
    const warmW = tracks.get('warm')?.weights ?? [];
    expect(warmW[0]).toBe(0);
    expect(warmW.at(-1)).toBe(1);
  });

  it('draws the channel that moves most, and a color-only voice as its colors', () => {
    expect(tracks.get('bob')).toMatchObject({ channel: 'offset y' });
    expect(tracks.get('bob')?.values).toHaveLength(21);
    const w = tracks.get('warm');
    expect(w?.channel).toBe('color');
    expect(w?.values).toBeUndefined();
    expect(new Set(w?.colors).size).toBeGreaterThan(1);
    expect(tracks.get('g')?.channel).toBeUndefined();
  });
});

describe('track paths', () => {
  it('spreads values to fill 0..1, and a flat run to the middle', () => {
    expect(spread([2, 4, 3])).toEqual([0, 1, 0.5]);
    expect(spread([5, 5])).toEqual([0.5, 0.5]);
  });

  it('insets a curve from the box, and fills an area to its foot', () => {
    expect(curve([0, 1], [0, 100], 100)).toBe('M0.00000,0.900 L1.00000,0.100');
    expect(area([1, 0], [0, 100], 100)).toBe(
      'M0.00000,0.000 L1.00000,1.000 L1.00000,1 L0.00000,1 Z',
    );
  });

  it('puts each sample where it was taken, so unevenly spaced samples of a ramp draw it straight', () => {
    // A ramp read on frames 0, 1, 3 and 4 of 4: spaced by index its middle would bend.
    const at = [0, 25, 75, 100];
    const xs = curve([0, 0.25, 0.75, 1], at, 100, 0)
      .split(' ')
      .map((p) => p.slice(1).split(',').map(Number));
    for (const [x, y] of xs) expect((x ?? 0) + (y ?? 0)).toBeCloseTo(1, 5);
  });

  it('thins gradient stops to about 60 across the run, each at its sample', () => {
    const at = Array.from({ length: 241 }, (_, k) => k * 10);
    const s = stops(
      Array.from({ length: 241 }, (_, k) => `c${k}`),
      at,
      2400,
    );
    expect(s[0]).toEqual({ at: 0, color: 'c0' });
    expect(s.at(-1)?.at).toBeLessThanOrEqual(1);
    expect(s.length).toBeLessThanOrEqual(61);
  });
});
