import { oklab, patch } from '@msb235/blits';
import type { Cell, Pose } from '../board';
import { layer } from './effect';

const BULB = oklab(0xffe2b0);

/** The theater chase on the border: one cell of three lit, stepping a cell each beat. Loops. */
export const chase = layer({
  name: 'chase',
  about: 'The border’s theater chase: every third bulb lit, stepping each beat.',
  on: 'cells',
  params: {
    beat: { label: 'beat', min: 40, max: 1000, step: 10, value: 180, unit: 'ms' },
    dim: { label: 'unlit glow', min: 0, max: 0.5, step: 0.01, value: 0.1 },
  },
  patch: (_b, p) =>
    patch<Cell, Pose>(
      p.beat * 3,
      (phase, cell) => {
        const beat = Math.floor(phase * 3);
        return { lit: (cell.i + 3 - beat) % 3 === 0 ? 1 : p.dim, tint: BULB };
      },
      { writes: ['lit', 'tint'] },
    ),
});
