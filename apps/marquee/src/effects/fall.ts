import { oklab, patch } from '@msb235/blits';
import { type Led, leftOf, type Pose } from '../board';
import { ROWS } from '../font';
import { rowOf, textEffect } from './effect';
import { hash } from './hash';

/** How far a column falls from or to: past the text's top or bottom. */
const DROP = ROWS + 1;

/** Columns dropping in from above at random times, standing, then falling out the bottom at others. */
export const fall = textEffect({
  name: 'fall',
  about: 'Columns drop in from above at random, then fall out the bottom.',
  params: {
    ms: { label: 'length', min: 1500, max: 10000, step: 100, value: 3800, unit: 'ms' },
    spread: { label: 'spread', min: 0, max: 2000, step: 50, value: 700, unit: 'ms' },
    drop: { label: 'drop time', min: 100, max: 1500, step: 25, value: 350, unit: 'ms' },
  },
  stage(b, text, hex, p) {
    const tint = oklab(hex);
    const left = leftOf(b, text);
    // Leaving takes as long as arriving, from rest under gravity: DROP rows in `drop` ms.
    const gravity = DROP / p.drop ** 2;
    const out = p.ms - p.spread - p.drop;
    return {
      patch: patch<Led, Pose>(
        p.ms,
        (phase, led) => {
          const row = rowOf(led);
          if (row < 0) return { lit: 0, tint };
          const x = led.x - left;
          const t = phase * p.ms;
          const lands = p.drop + p.spread * hash(x, 1, text.cols);
          const leaves = out + p.spread * hash(x, 2, text.cols);
          let d: number;
          if (t < lands - p.drop) d = -DROP;
          else if (t < lands) d = -DROP * (1 - ((t - lands + p.drop) / p.drop) ** 2);
          else if (t < leaves) d = 0;
          else d = gravity * (t - leaves) ** 2;
          return { lit: text.lit(x, row - Math.round(d)) ? 1 : 0, tint };
        },
        { writes: ['lit', 'tint'] },
      ),
      ms: p.ms,
    };
  },
});
