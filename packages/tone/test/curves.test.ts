import { describe, expect, it } from 'vitest';
import { offBy, onsets, render, sampleAt, worst } from './render.js';
import { type Act, hitTimes, type Pose, reference, SR } from './scene.js';

// The spike's run: at 1.5 s the notes play half again as fast and the sweep eases to half speed;
// at 2.5 s both are sought.
const acts: Act[] = [
  {
    at: 1500,
    run: (_, h) => {
      h.notes.rate = 1.5;
      h.sweep.ramp(0.5, 300);
    },
  },
  {
    at: 2500,
    run: (_, h) => {
      h.notes.seek(100);
      h.sweep.seek(0);
    },
  },
];

const truth = (done: readonly number[]) =>
  hitTimes([
    { from: 0, e0: 0, rate: 1 },
    { from: done[0] as number, e0: done[0] as number, rate: 1.5 },
    { from: done[1] as number, e0: 100, rate: 1.5, sought: true },
  ]);

/** The 200 ms stall at 3.2 s, which outlasts 150 ms read ahead. */
const STALL = [3200, 3420] as const;

describe('curves and notes through retimes, seeks, and stalled frames', () => {
  it.each([
    { grid: 5, freq: 0.15, gain: 1e-4 },
    { grid: 25, freq: 1.8, gain: 2e-3 },
  ])('a $grid ms grid stays within $freq Hz of the mix', async ({ grid, freq, gain }) => {
    const r = await render({ acts, grid });
    const ref = reference(acts, r.done);
    expect(worst(r.freq, ref, 'freq', STALL)).toBeLessThan(freq);
    expect(worst(r.gain, ref, 'gain', STALL)).toBeLessThan(gain);
  });

  it('holds through a gap longer than it read ahead, and not through one it covers', async () => {
    const short = await render({ acts, ahead: 150 });
    const long = await render({ acts, ahead: 250 });
    const ref = reference(acts, short.done);
    expect(worst(short.freq, ref, 'freq')).toBeGreaterThan(20);
    expect(worst(long.freq, ref, 'freq')).toBeLessThan(0.15);
  });

  it('sounds every note within a sample of its time', async () => {
    const r = await render({ acts });
    const expected = truth(r.done);
    expect(onsets(r.notes)).toHaveLength(expected.length);
    expect(Math.max(...offBy(r.notes, expected))).toBeLessThan(1000 / SR + 1e-9);
  });
});

describe('a straight stretch of a keys voice', () => {
  it('plays it exactly, whatever the grid', async () => {
    // The sweep falls in a straight line over the second half of each pass; it rises eased.
    const r = await render({ grid: 25 });
    const ref = reference([], []);
    let max = 0;
    for (const [from, to] of [
      [1000, 2000],
      [3000, 3200],
    ] as const)
      for (let t = from; t < to; t++)
        max = Math.max(max, Math.abs((r.freq[sampleAt(t)] as number) - (ref[t] as Pose).freq));
    expect(max).toBeLessThan(1e-3);
  });
});
