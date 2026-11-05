import { patch, type WaveShape } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { cycleMs, depth, modulator, phasePerStep, RATE, unitAt } from './modulator.js';
import { RANK, rankAt, SHAPES, shader, unitOf } from './shader.js';

/** Steady holds; the rest swing along the wave `SHAPES` names, from the code past it. */
const STEADY = -1;

const INVERT = shader({
  params: ['shape', 'depth', 'phase', 'by', 'cols'],
  wgsl: `let swing = select(1.0, bree_unit(params.shape, ph + ${RANK} * params.phase), params.shape >= 0.0);
out.invert = select(params.depth * swing, 0.0, subject.cell > 0.5);`,
  at: (ph, s, p) => {
    if (s.kind === 'cell') return { invert: 0 };
    const shape = p.shape as number;
    const depth = p.depth as number;
    return {
      invert:
        shape === STEADY ? depth : depth * unitOf(shape, ph + rankAt(p, s) * (p.phase as number)),
    };
  },
  writes: ['invert'],
});

/**
 * `invert` swinging between 0 and `depth`, or held at `depth` when steady: lit dots go dark and
 * dark dots light. Spread by column, a wave sweeps the swap across the sign.
 */
export const invert = modulator({
  name: 'invert',
  about: 'Swaps lit and dark dots, held or swinging back and forth.',
  params: {
    shape: {
      label: 'shape',
      choices: ['steady', 'square', 'sine', 'triangle'],
      value: 'steady',
      about:
        'Steady holds the sign swapped; square flips it back and forth, and sine and triangle fade between the two.',
    },
    rate: { ...RATE, value: 0.5 },
    depth: depth(
      1,
      'How far the swap goes. At 1 lit and dark trade places; lower only grays them toward each other.',
    ),
    phase: phasePerStep(0),
  },
  writes: ['invert'],
  on: 'dots',
  patch: (_at, p, rank) =>
    patch<Subject, Pose>(
      cycleMs(p.rate),
      (phase, s) => ({
        invert:
          p.shape === 'steady'
            ? p.depth
            : p.depth * unitAt(p.shape as WaveShape, phase + rank(s) * p.phase),
      }),
      { writes: ['invert'] },
    ),
  shader: (_at, p, rank) => {
    const steady = p.shape === 'steady';
    // Held steady, it reads no rank, so any spread will do.
    const order = rank ?? (steady ? { by: 0, cols: 1 } : null);
    if (!order) return null;
    return INVERT(cycleMs(p.rate), {
      shape: steady ? STEADY : SHAPES.indexOf(p.shape as WaveShape),
      depth: p.depth,
      phase: p.phase,
      ...order,
    });
  },
});
