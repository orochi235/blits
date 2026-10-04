import type { Clip } from '@pg/widgets/ScoreLanes';
import { clipEnd, clipPolygon, passLines, scaleOf } from '@pg/widgets/ScoreLanes/geometry';
import { describe, expect, it } from 'vitest';

const clip = (c: Partial<Clip>): Clip => ({
  id: 'a',
  lane: 0,
  label: 'a',
  hue: 200,
  start: 0,
  pass: 500,
  passes: 2,
  fadeIn: 0,
  fadeOut: 0,
  spread: 0,
  holdBefore: false,
  holdAfter: false,
  ...c,
});

describe('geometry', () => {
  it('maps time to x past the label column and back', () => {
    const s = scaleOf(2000, 1140, 140);
    expect(s.x(0)).toBe(140);
    expect(s.x(2000)).toBe(1140);
    expect(s.t(640)).toBe(1000);
  });
  it('ends a clip after its passes, or never', () => {
    expect(clipEnd(clip({ start: 100 }))).toBe(1100);
    expect(clipEnd(clip({ passes: Number.POSITIVE_INFINITY }))).toBe(Number.POSITIVE_INFINITY);
  });
  it('slopes the fades', () => {
    const s = scaleOf(1000, 1000, 0);
    expect(clipPolygon(clip({ fadeIn: 100, fadeOut: 200 }), s, 10, 20, 1000)).toBe(
      '0,30 100,10 800,10 1000,30',
    );
  });
  it('draws an open clip to the view end', () => {
    const s = scaleOf(1000, 1000, 0);
    expect(clipPolygon(clip({ passes: Number.POSITIVE_INFINITY }), s, 0, 10, 1000)).toBe(
      '0,10 0,0 1000,0 1000,10',
    );
  });
  it('puts dividers between passes, none for an aperiodic clip', () => {
    expect(passLines(clip({ passes: 3 }), 5000)).toEqual([500, 1000]);
    expect(passLines(clip({ pass: 0, passes: 1 }), 5000)).toEqual([]);
  });
});
