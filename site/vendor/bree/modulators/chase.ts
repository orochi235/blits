import { oklab, patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { modulator } from './modulator.js';
import { f32, shader } from './shader.js';

const BULB = oklab(0xffe2b0);
const NONE = [0, 0, 0, 0];

/** A cell's pose on beat `beat` of three: lit every third, the rest at `dim`; a dot is left at rest. */
const poseOf = (s: Subject, beat: number, dim: number): Partial<Pose> =>
  s.kind === 'cell'
    ? { lit: (s.i + 3 - beat) % 3 === 0 ? 1 : dim, tint: BULB }
    : { lit: 0, tint: NONE };

const CHASE = shader({
  params: ['dim'],
  wgsl: `let lit = u32(subject.i + 3.0 - floor(ph * 3.0)) % 3u == 0u;
out.lit = 0.0;
out.tint = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
if (subject.cell > 0.5) {
  out.lit = select(params.dim, 1.0, lit);
  out.tint = array<f32, 4>(${BULB.map(f32).join(', ')});
}`,
  at: (ph, s, p) => poseOf(s, Math.floor(ph * 3), p.dim as number),
  writes: ['lit', 'tint'],
});

/** The theater chase on the border: one cell of three lit, stepping a cell each beat. Loops. */
export const chase = modulator({
  name: 'chase',
  about: 'The border’s theater chase: every third bulb lit, stepping each beat.',
  params: {
    beat: {
      label: 'beat',
      min: 40,
      max: 1000,
      step: 10,
      value: 180,
      unit: 'ms',
      about: 'How long the lit bulbs wait before stepping to the next. Higher chases more slowly.',
    },
    dim: {
      label: 'unlit glow',
      min: 0,
      max: 0.5,
      step: 0.01,
      value: 0.1,
      about:
        'How bright the bulbs between the lit ones stay. At 0 they go dark; higher keeps them glowing.',
    },
  },
  writes: ['lit', 'tint'],
  on: 'cells',
  patch: (_at, p) =>
    patch<Subject, Pose>(
      p.beat * 3,
      (phase, s) => (s.kind === 'cell' ? poseOf(s, Math.floor(phase * 3), p.dim) : {}),
      { writes: ['lit', 'tint'] },
    ),
  shader: (_at, p) => CHASE(p.beat * 3, { dim: p.dim }),
});
