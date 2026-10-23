import { oklab, patch } from '@msb235/blits';
import type { Led, Pose } from '../board';
import { rowOf, textEffect } from './effect';

/** Text crossing the sign a whole column at a time, in at one edge and out at the other. */
export const scroll = textEffect({
  name: 'scroll',
  about: 'Crosses the sign a column at a time.',
  params: {
    step: { label: 'column time', min: 10, max: 200, step: 1, value: 45, unit: 'ms' },
    rightward: { label: 'rightward', min: 0, max: 1, step: 1, value: 0 },
  },
  stage(b, text, hex, p) {
    const tint = oklab(hex);
    const steps = text.cols + b.cols;
    return {
      patch: patch<Led, Pose>(
        steps * p.step,
        (phase, led) => {
          const moved = Math.floor(phase * steps);
          const offset = p.rightward ? text.cols - moved : moved - b.cols;
          return { lit: text.lit(led.x + offset, rowOf(led)) ? 1 : 0, tint };
        },
        { writes: ['lit', 'tint'] },
      ),
      ms: steps * p.step,
    };
  },
});
