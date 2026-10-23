import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board';
import { layer } from './effect';
import { hash } from './hash';

/** Stray dots lighting for a moment, from a hash of where and when. Loops. */
export const sparkle = layer({
  name: 'sparkle',
  about: 'Stray dots light for a moment at random.',
  on: 'dots',
  params: {
    rate: { label: 'lit at once', min: 0, max: 0.1, step: 0.001, value: 0.0067, unit: 'of dots' },
    frame: { label: 'twinkle', min: 10, max: 500, step: 5, value: 50, unit: 'ms' },
  },
  patch: (_b, p) => {
    const below = 1 - p.rate;
    const frames = Math.max(1, Math.round(1000 / p.frame));
    return patch<Led, Pose>(
      frames * p.frame,
      (phase, led) => {
        const h = hash(led.x, led.y, Math.floor(phase * frames));
        return { lit: h > below ? (h - below) / p.rate : 0 };
      },
      { writes: ['lit'] },
    );
  },
});
