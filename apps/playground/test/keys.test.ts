import { toBlits, toWeasel } from '@pg/blits/easing';
import { stopsOf, tracksOf } from '@pg/blits/keys';
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
      { at: 0.5, delta: { scale: 2 }, ease: { bezier: [0.42, 0, 1, 1] } },
      { at: 1, delta: { scale: 1, offset: [10, 0] } },
    ]);
  });
});

describe('easing', () => {
  it('maps named curves through bezier points', () => {
    expect(toWeasel('ease-out')).toEqual({ bezier: [0, 0, 0.58, 1] });
    expect(toWeasel('linear')).toBeUndefined();
    expect(toBlits({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual({ bezier: [0.1, 0.2, 0.3, 0.4] });
    expect(toBlits(undefined)).toBeUndefined();
  });
});
