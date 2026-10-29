import { describe, expect, it } from 'vitest';
import { offBy, onsets, render, worst } from './render.js';
import { type Act, hitTimes, reference, SR } from './scene.js';

/** The 200 ms stall at 3.2 s, which outlasts 150 ms read ahead. */
const STALL = [3200, 3420] as const;

describe('a host clock that is not the audio clock', () => {
  const notes = hitTimes([{ from: 0, e0: 0, rate: 1 }]);

  it('plays the same samples when the host clock reads 5 s past the audio clock', async () => {
    const level = await render();
    const skewed = await render({ skew: 5000 });
    expect(worst(level.freq, reference([], []), 'freq', STALL)).toBeLessThan(0.75);
    let apart = 0;
    for (let i = 0; i < level.freq.length; i++)
      apart = Math.max(apart, Math.abs((level.freq[i] as number) - (skewed.freq[i] as number)));
    expect(apart).toBeLessThan(1e-3);
    expect(onsets(skewed.notes)).toHaveLength(notes.length);
    expect(Math.max(...offBy(skewed.notes, notes))).toBeLessThan(1000 / SR + 1e-9);
  });

  it('smooths a clock read up to 1 ms off each frame', async () => {
    const r = await render({ skew: 5000, jitter: 1 });
    expect(worst(r.freq, reference([], [], 5000), 'freq', STALL)).toBeLessThan(0.2);
    expect(Math.max(...offBy(r.notes, notes))).toBeLessThan(0.25);
  });
});

describe('a mix whose rate is not 1', () => {
  it('lands curves and notes at half speed', async () => {
    const acts: Act[] = [{ at: 1000, run: (m) => (m.rate = 0.5) }];
    const r = await render({ acts });
    const ref = reference(acts, r.done);
    const at = r.done[0] as number;
    const expected = hitTimes([
      { from: 0, e0: 0, rate: 1 },
      { from: at, e0: at, rate: 0.5 },
    ]);
    expect(worst(r.freq, ref, 'freq', STALL)).toBeLessThan(0.68);
    expect(onsets(r.notes)).toHaveLength(expected.length);
    expect(Math.max(...offBy(r.notes, expected))).toBeLessThan(1000 / SR + 1e-9);
  });

  it('holds while the mix is paused and picks up when it resumes', async () => {
    const acts: Act[] = [
      { at: 1300, run: (m) => (m.rate = 0) },
      { at: 2100, run: (m) => (m.rate = 1) },
    ];
    const r = await render({ acts });
    const ref = reference(acts, r.done);
    expect(worst(r.freq, ref, 'freq', STALL)).toBeLessThan(0.68);
  });

  it('only approximates a ramp of the rate, by the rate at each write', async () => {
    const acts: Act[] = [{ at: 1000, run: (m) => m.ramp(0.5, 600) }];
    const r = await render({ acts });
    const ref = reference(acts, r.done);
    expect(worst(r.freq, ref, 'freq', STALL)).toBeLessThan(5);
  });
});
