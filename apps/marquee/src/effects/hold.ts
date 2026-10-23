import { oklab, patch } from '@msb235/blits';
import { type Led, leftOf, type Pose } from '../board';
import { rowOf, textEffect } from './effect';

/**
 * Text standing centered, flashing in the middle of its time. Cued with a stagger by column, which
 * gives the wipe on and off: each column plays the same pass, later.
 */
export const hold = textEffect({
  name: 'hold',
  about: 'Stands centered, wiping on and off by column and flashing midway.',
  params: {
    ms: { label: 'length', min: 1000, max: 10000, step: 100, value: 3600, unit: 'ms' },
    wipe: { label: 'wipe lag', min: 0, max: 60, step: 1, value: 14, unit: 'ms/col' },
    flashes: { label: 'flashes', min: 0, max: 6, step: 1, value: 3 },
  },
  stage(b, text, hex, p) {
    const tint = oklab(hex);
    const left = leftOf(b, text);
    // The flashes sit in the middle third, each one on for half its beat.
    const from = p.ms / 3;
    const beat = p.flashes > 0 ? p.ms / 3 / p.flashes : Infinity;
    return {
      patch: patch<Led, Pose>(
        p.ms,
        (phase, led) => {
          const t = phase * p.ms - from;
          const flashing = t > 0 && t < p.ms / 3 && t % beat > beat / 2;
          const on = !flashing && phase < 0.97 && text.lit(led.x - left, rowOf(led));
          return { lit: on ? 1 : 0, tint };
        },
        { writes: ['lit', 'tint'] },
      ),
      stagger: (led) => led.x * p.wipe,
      ms: p.ms + (b.cols - 1) * p.wipe,
    };
  },
});
