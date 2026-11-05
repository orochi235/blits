import { type Mix, tween } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { drive, Tone } from './audio.js';
import { offBy, onsets, render, sampleAt, worst } from './render.js';
import {
  type Act,
  DUR,
  frameTimes,
  hitTimes,
  make,
  type Pose,
  reference,
  SR,
  SUBJECT,
} from './scene.js';

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
    { grid: 5, freq: 0.04, gain: 1e-4 },
    { grid: 25, freq: 0.04, gain: 2e-3 },
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
    expect(worst(long.freq, ref, 'freq')).toBeLessThan(0.04);
  });

  it('sounds every note within a sample of its time', async () => {
    const r = await render({ acts });
    const expected = truth(r.done);
    expect(onsets(r.notes)).toHaveLength(expected.length);
    expect(Math.max(...offBy(r.notes, expected))).toBeLessThan(1000 / SR + 1e-9);
  });
});

describe('a keys voice, eased or straight', () => {
  it('plays it whatever the grid: the straight stretches exactly, the eased ones as close lines', async () => {
    // The sweep rises eased over the first half of each pass and falls in a straight line.
    const r = await render({ grid: 25 });
    const ref = reference([], []);
    const off = (from: number, to: number) => {
      let max = 0;
      for (let t = from; t < to; t++)
        max = Math.max(max, Math.abs((r.freq[sampleAt(t)] as number) - (ref[t] as Pose).freq));
      return max;
    };
    expect(Math.max(off(1000, 2000), off(3000, 3200))).toBeLessThan(1e-3);
    expect(Math.max(off(20, 3200), off(3420, 3999))).toBeLessThan(0.04);
  });
});

describe('a tween', () => {
  /** A tween on `freq` from 200 to 800 Hz over 900 ms. */
  const slide = (m: Mix<string, Pose>) => {
    const t = tween<string, Pose>('freq', { from: 200, to: 800, ms: 900, ease: 'ease-in-out' });
    m.cue({ patch: t });
    return t;
  };

  it.each([
    ['timed', true],
    ['untimed', false],
  ])('plays its stretches exactly, a retarget %s included, whatever the grid', async (_, timed) => {
    // Sent toward 300 Hz at the first frame from 1.4 s. Nothing probes the subject, so an untimed
    // one is read ahead from when it was made.
    let turn = Number.NaN;
    const buffer = await Tone.Offline(
      () => {
        const freq = new Tone.Signal(0).toDestination();
        const m = make();
        let read = 0;
        const driver = drive(m, { clock: () => read / 1000, grid: 25 });
        driver.attach(SUBJECT, { freq });
        m.sync(0);
        const t = slide(m);
        for (const f of frameTimes()) {
          read = f;
          m.sync(f);
          if (Number.isNaN(turn) && f >= 1400) {
            turn = f;
            if (timed) t.to(SUBJECT, 300, f);
            else t.to(SUBJECT, 300);
          }
          driver.write();
        }
      },
      DUR / 1000,
      1,
      SR,
    );
    const rendered = buffer.getChannelData(0).slice();
    const m = make();
    m.sync(0);
    slide(m).to(SUBJECT, 300, turn);
    let max = 0;
    for (let ms = 20; ms < DUR - 1; ms++) {
      m.sync(ms);
      if (ms >= STALL[0] && ms <= STALL[1]) continue;
      max = Math.max(max, Math.abs((rendered[sampleAt(ms)] as number) - m.probe(SUBJECT).freq));
    }
    expect(max).toBeLessThan(0.04);
  });
});
