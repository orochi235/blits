import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import { hash } from '../hash.js';
import { litAt, move, on } from './move.js';

/** How much of its column's start a dot can lag by, as a share of the pass. */
const JITTER = 0.12;

/** The message dripping off the bottom, each dot falling at its own speed and smearing as it goes. */
export const melt = move({
  name: 'melt',
  about: 'Dots drip down at random speeds, smearing into streaks as they run off the bottom.',
  slot: 'exit',
  params: {
    ms: {
      label: 'melt time',
      min: 300,
      max: 6000,
      step: 50,
      value: 2200,
      unit: 'ms',
      about: 'How long the message takes to drip away, from the first drop to the last.',
    },
    tail: {
      label: 'streak',
      min: 0,
      max: 12,
      step: 1,
      value: 4,
      unit: 'dots',
      about: 'How long the fading streak behind each falling dot grows. At 0 the dots fall clean.',
    },
    spread: {
      label: 'stagger',
      min: 0,
      max: 0.8,
      step: 0.05,
      value: 0.45,
      about:
        'How scattered the columns’ start times are. At 0 every column lets go at once; higher spreads them out.',
    },
    seed: {
      label: 'seed',
      min: 1,
      max: 99,
      step: 1,
      value: 1,
      about: 'Which drips fall when. Each number is a different melt.',
    },
  },
  patch(at, p) {
    const { cols, rows } = at.board;
    const dots = at.board.dots.flatMap((led) => {
      const level = litAt(at, led);
      if (level <= 0) return [];
      // A column drips together, its lower dots letting go first so it stretches as it runs.
      const high = 1 - led.y / Math.max(1, rows - 1);
      const lag = JITTER * (0.6 * high + 0.4 * hash(led.x, led.y, p.seed));
      const start = p.spread * hash(led.x, p.seed, 1) + lag;
      const speed = 0.4 + 0.6 * hash(led.x, p.seed, 2);
      const ms = (1 - start) * speed * (0.9 + 0.1 * hash(led.y, led.x, p.seed + 7));
      return [{ x: led.x, y: led.y, level, start, ms, drop: rows - led.y + p.tail + 1 }];
    });
    const frames = new Map<number, Float32Array>();
    const frame = (phase: number) => {
      let f = frames.get(phase);
      if (f) return f;
      f = new Float32Array(cols * rows);
      const light = (x: number, y: number, v: number) => {
        if (y < 0 || y >= rows) return;
        const k = y * cols + x;
        f[k] = Math.max(f[k] as number, v);
      };
      for (const d of dots) {
        const u = Math.min(1, Math.max(0, (phase - d.start) / d.ms));
        const fallen = Math.round(d.drop * u * u);
        // The streak lengthens as the drip speeds up, and never reaches above where it hung.
        const tail = Math.min(fallen, Math.round(p.tail * u));
        for (let k = 0; k <= tail; k++)
          light(d.x, d.y + fallen - k, d.level * (1 - k / (tail + 1)));
      }
      if (frames.size > 256) frames.clear();
      frames.set(phase, f);
      return f;
    };
    return patch<Led, Pose>(
      p.ms,
      (phase, led) => on(led.kind === 'dot' ? (frame(phase)[led.y * cols + led.x] ?? 0) : 0),
      { writes: ['lit'] },
    );
  },
});
