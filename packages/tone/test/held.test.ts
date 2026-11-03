import { describe, expect, it } from 'vitest';
import { hold, ramp } from '../src/held.js';
import { Tone } from './audio.js';

describe('a hold', () => {
  it.each([5e-7, 1e-6, -1e-6])(
    'keeps the line into a point scheduled %s s from it',
    async (gap) => {
      const b = await Tone.Offline(
        () => {
          const s = new Tone.Signal(0).toDestination();
          hold(s, 0);
          ramp(s, 10, 0.01);
          ramp(s, 20, 0.02 + gap);
          ramp(s, 30, 0.03);
          ramp(s, 30, hold(s, 0.02) + 0.01);
        },
        0.04,
        1,
        48000,
      );
      const d = b.getChannelData(0);
      expect(d[480]).toBeCloseTo(10, 2);
      expect(d[720]).toBeCloseTo(15, 2);
      expect(d[1200]).toBeCloseTo(25, 1);
    },
  );
});
