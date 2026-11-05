import { patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { bump, modulator } from './modulator.js';
import { type Bound, f32, shader } from './shader.js';

/** How much the band's halo grows at its middle. */
const GLOW = 0.6;

/** How near the band's middle row `y` is at `ph`, as a bump: 1 at its middle, 0 outside it. */
const nearAt = (ph: number, y: number, p: Bound) => {
  const travel = p.travel as number;
  const band = p.band as number;
  const off = Math.abs(y - (ph * travel - band / 2));
  return bump(Math.min(off, travel - off) / (band / 2 + 0.5));
};

const SCANLINE = shader({
  params: ['travel', 'band', 'dim'],
  wgsl: `let off = abs(subject.y - (ph * params.travel - params.band / 2.0));
let k = select(bree_bump(min(off, params.travel - off) / (params.band / 2.0 + 0.5)), 0.0, subject.cell > 0.5);
out.gain = select(1.0 - params.dim * (1.0 - k), 1.0, subject.cell > 0.5);
out.glow = 1.0 + ${f32(GLOW)} * k;`,
  at: (ph, s, p) => {
    if (s.kind === 'cell') return { gain: 1, glow: 1 };
    const k = nearAt(ph, s.y, p);
    return { gain: 1 - (p.dim as number) * (1 - k), glow: 1 + GLOW * k };
  },
  writes: ['gain', 'glow'],
});

/**
 * A bright band rolling down the rows and round to the top again, the rows outside it dimmed:
 * the roll bar of a CRT. Loops; ignores the order.
 */
export const scanline = modulator({
  name: 'scanline',
  about: 'A bright band rolls down the rows like a CRT’s, the rest a little dimmer.',
  params: {
    speed: {
      label: 'speed',
      min: 1,
      max: 60,
      step: 1,
      value: 9,
      unit: 'rows/s',
      about: 'How many rows a second the band rolls down. Higher rolls faster.',
    },
    band: {
      label: 'band height',
      min: 1,
      max: 20,
      step: 0.5,
      value: 2.5,
      unit: 'rows',
      about: 'How many rows the bright band covers. Higher makes a taller, softer band.',
    },
    dim: {
      label: 'dimming',
      min: 0,
      max: 0.9,
      step: 0.01,
      value: 0.45,
      about:
        'How much dimmer the rows outside the band are. At 0 they stay at full brightness; higher darkens them.',
    },
  },
  writes: ['gain', 'glow'],
  on: 'dots',
  patch: (at, p) => {
    const bound = { travel: at.board.rows + p.band, band: p.band };
    return patch<Subject, Pose>(
      (bound.travel / p.speed) * 1000,
      (phase, s) => {
        if (s.kind === 'cell') return {};
        const k = nearAt(phase, s.y, bound);
        return { gain: 1 - p.dim * (1 - k), glow: 1 + GLOW * k };
      },
      { writes: ['gain', 'glow'] },
    );
  },
  shader: (at, p) => {
    const travel = at.board.rows + p.band;
    return SCANLINE((travel / p.speed) * 1000, { travel, band: p.band, dim: p.dim });
  },
});
