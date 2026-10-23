import { oklab, patch } from '@msb235/blits';
import { type Led, leftOf, type Pose } from '../board';
import { ADVANCE, ROWS } from '../font';
import { rowOf, textEffect } from './effect';

const MID = (ROWS - 1) / 2;
/** How long a letter takes to unfold at the start and to fold away at the end. */
const FOLD_MS = 300;

/** A letter's turn about its own horizontal middle, radians, `t` ms into a pass of `ms`. */
export function turnAt(t: number, ms: number, turns: number): number {
  const quarter = Math.PI / 2;
  if (t < FOLD_MS) return quarter * (1 - t / FOLD_MS);
  if (t > ms - FOLD_MS) return quarter * Math.min(1, (t - ms + FOLD_MS) / FOLD_MS);
  // The tumbles take the middle third, the letter standing still either side.
  const u = (t - ms / 3) / (ms / 3);
  return u > 0 && u < 1 ? 2 * Math.PI * turns * u : 0;
}

/**
 * Letters turning end over end about their middles: each unfolds from edge on, tumbles, and folds
 * away, one letter after another by a stagger.
 */
export const flip = textEffect({
  name: 'flip',
  about: 'Letters unfold, tumble end over end one after another, and fold away.',
  params: {
    ms: { label: 'length', min: 1500, max: 10000, step: 100, value: 3600, unit: 'ms' },
    turns: { label: 'turns', min: 0, max: 6, step: 1, value: 2 },
    lag: { label: 'letter lag', min: 0, max: 400, step: 10, value: 90, unit: 'ms' },
  },
  stage(b, text, hex, p) {
    const tint = oklab(hex);
    const left = leftOf(b, text);
    const n = text.cols / ADVANCE;
    const any = Array.from({ length: text.cols }, (_, x) =>
      Array.from({ length: ROWS }, (_, y) => text.lit(x, y)).some(Boolean),
    );
    return {
      patch: patch<Led, Pose>(
        p.ms,
        (phase, led) => {
          const row = rowOf(led);
          const x = led.x - left;
          if (row < 0 || phase > 0.99) return { lit: 0, tint };
          const s = Math.cos(turnAt(phase * p.ms, p.ms, p.turns));
          // Edge on, a letter is a line across its middle.
          if (Math.abs(s) < 0.18) return { lit: row === 3 && any[x] ? 1 : 0, tint };
          return { lit: text.lit(x, Math.round(MID + (row - MID) / s)) ? 1 : 0, tint };
        },
        { writes: ['lit', 'tint'] },
      ),
      stagger: (led) => Math.min(n - 1, Math.max(0, Math.floor((led.x - left) / ADVANCE))) * p.lag,
      ms: p.ms + (n - 1) * p.lag,
    };
  },
});
