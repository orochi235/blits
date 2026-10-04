import type { Keyframe } from '@msb235/blits';
import { toBlits, toWeasel } from '@pg/blits/easing';
import { stopsOf, tracksOf } from '@pg/blits/keys';
import type { Pose } from '@pg/blits/kit';
import { resolveEasing } from '@weasel-js/core';
import { describe, expect, it } from 'vitest';

const stops = [
  { at: 0, delta: { scale: 1, offset: [0, 0] } },
  { at: 0.5, delta: { scale: 2 }, ease: 'ease-in' as const },
  { at: 1, delta: { scale: 1, offset: [10, 0] } },
];

describe('tracksOf / stopsOf', () => {
  it('splits stops into one track per channel, in ms', () => {
    const tracks = tracksOf(stops, 400);
    expect(tracks.map((t) => t.label)).toEqual(['offset', 'scale']);
    expect(tracks[0]?.keys.map((k) => k.t)).toEqual([0, 400]);
    expect(tracks[1]?.keys.map((k) => k.t)).toEqual([0, 200, 400]);
  });

  it('round-trips', () => {
    const back = stopsOf(tracksOf(stops, 400), 400);
    expect(back).toEqual([
      { at: 0, delta: { scale: 1, offset: [0, 0] } },
      { at: 0.5, delta: { scale: 2 }, ease: 'ease-in' },
      { at: 1, delta: { scale: 1, offset: [10, 0] } },
    ]);
  });
});

describe('stopsOf keeps eases weasel cannot express', () => {
  const round = (ease: Keyframe<Pose>['ease']) => {
    const before: Keyframe<Pose>[] = [
      { at: 0, delta: { scale: 1 } },
      { at: 1, delta: { scale: 2 }, ease },
    ];
    return stopsOf(tracksOf(before, 400), 400, before);
  };

  it('steps', () => {
    expect(round({ steps: 4, jump: 'start' })[1]?.ease).toEqual({ steps: 4, jump: 'start' });
  });

  it('a function', () => {
    const fn = (u: number) => u * u;
    expect(round(fn)[1]?.ease).toBe(fn);
  });

  it("explicit 'linear', which differs from no ease once the keys option sets one", () => {
    expect(round('linear')[1]?.ease).toBe('linear');
  });

  it('an ease the user set on the track wins over the previous one', () => {
    const before: Keyframe<Pose>[] = [
      { at: 0, delta: { scale: 1 } },
      { at: 1, delta: { scale: 2 }, ease: 'linear' },
    ];
    const tracks = tracksOf(before, 400);
    const key = tracks[0]?.keys[1];
    if (key) key.easing = { bezier: [0, 0, 1, 1] };
    expect(stopsOf(tracks, 400, before)[1]?.ease).toEqual({ bezier: [0, 0, 1, 1] });
  });
});

describe('easing', () => {
  it('maps named curves through bezier points', () => {
    expect(toWeasel('ease-out')).toEqual({ bezier: [0, 0, 0.58, 1] });
    expect(toWeasel('linear')).toBeUndefined();
    expect(toBlits({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual({ bezier: [0.1, 0.2, 0.3, 0.4] });
    expect(toBlits(undefined)).toBeUndefined();
  });

  it('turns a weasel named curve into bezier points, and shows them by name again', () => {
    expect(toBlits('easeOutQuad')).toEqual({ bezier: [0.5, 1, 0.89, 1] });
    expect(toWeasel({ bezier: [0.5, 1, 0.89, 1] })).toBe('easeOutQuad');
    expect(toBlits('linear')).toBe('linear');
  });

  it('gives points that match a CSS name that name', () => {
    expect(toBlits({ bezier: [0.42, 0, 0.58, 1] })).toBe('ease-in-out');
    expect(toBlits({ bezier: [0.25, 0.1, 0.25, 1] })).toBe('ease');
  });

  it('refuses a curve with no bezier form', () => {
    expect(toBlits('easeOutBounce')).toBeNull();
    expect(toBlits('easeInElastic')).toBeNull();
    expect(toBlits(resolveEasing('easeOutQuad'))).toBeNull();
  });

  it('keeps the old ease when the timeline picks a refused curve, and stays JSON', () => {
    const before: Keyframe<Pose>[] = [
      { at: 0, delta: { scale: 1 } },
      { at: 1, delta: { scale: 2 }, ease: 'ease-out' },
    ];
    const tracks = tracksOf(before, 400);
    const key = tracks[0]?.keys[1];
    if (key) key.easing = 'easeOutBounce';
    const after = stopsOf(tracks, 400, before);
    expect(after[1]?.ease).toBe('ease-out');
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  });
});
