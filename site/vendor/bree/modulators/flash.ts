import { patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { depth, modulator, phasePerStep } from './modulator.js';
import { type Bound, RANK, rankAt, shader } from './shader.js';

const SHARE = { min: 0, max: 1, step: 0.01, unit: 'of the pass' };

/** Gain at `u` cycles into a pass: dark for the second half of each of `flashes` beats in the window. */
const gainAt = (u: number, p: Bound) => {
  const window = (p.to as number) - (p.from as number);
  const w = (u - Math.floor(u) - (p.from as number)) / window;
  const dark = window > 0 && w >= 0 && w < 1 && (w * (p.flashes as number)) % 1 >= 0.5;
  return dark ? 1 - (p.depth as number) : 1;
};

const FLASH = shader({
  params: ['flashes', 'from', 'to', 'depth', 'phase', 'by', 'cols'],
  wgsl: `let u = ph + ${RANK} * params.phase;
let window = params.to - params.from;
let w = (u - floor(u) - params.from) / window;
let dark = window > 0.0 && w >= 0.0 && w < 1.0 && fract(w * params.flashes) >= 0.5;
out.gain = select(select(1.0, 1.0 - params.depth, dark), 1.0, subject.cell > 0.5);`,
  at: (ph, s, p) => ({
    gain: s.kind === 'cell' ? 1 : gainAt(ph + rankAt(p, s) * (p.phase as number), p),
  }),
  writes: ['gain'],
});

/**
 * Gain blinking off within a window of each pass: `flashes` beats across it, each dark for its
 * second half. At its defaults the window is the whole pass and it blinks once a pass: once a
 * second, or once over the hold in an active slot that has one.
 */
export const flash = modulator({
  name: 'flash',
  about: 'Dots blink off and on, a number of times within a window of each pass.',
  params: {
    ms: {
      label: 'length',
      min: 100,
      max: 10000,
      step: 100,
      value: 1000,
      unit: 'ms',
      about: 'How long one pass lasts before the blinking repeats.',
    },
    flashes: {
      label: 'flashes',
      min: 0,
      max: 12,
      step: 1,
      value: 1,
      about: 'How many times the dots blink within the window. Higher blinks faster.',
    },
    from: {
      label: 'from',
      ...SHARE,
      value: 0,
      about: 'Where in each pass the blinking starts, as a share of the pass.',
    },
    to: {
      label: 'to',
      ...SHARE,
      value: 1,
      about: 'Where in each pass the blinking stops, as a share of the pass.',
    },
    depth: depth(1, 'How dark a blink goes. At 1 the dots switch fully off; lower only dims them.'),
    phase: phasePerStep(0.02),
  },
  writes: ['gain'],
  on: 'dots',
  patch: (_at, p, rank) =>
    patch<Subject, Pose>(p.ms, (phase, s) => ({ gain: gainAt(phase + rank(s) * p.phase, p) }), {
      writes: ['gain'],
    }),
  shader: (_at, p, rank) => (rank ? FLASH(p.ms, { ...p, ...rank }) : null),
});
