import { patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { modulator } from './modulator.js';
import { type Bound, f32, shader } from './shader.js';

const TAU = Math.PI * 2;

/** The hue a dot drifts to at `phase`: three sines across the board, scaled to half the range. */
function hueAt(phase: number, sx: number, sy: number, p: Bound): number {
  const x = sx / (p.scale as number);
  const y = sy / (p.tall as number);
  const t = phase * TAU;
  const f =
    0.5 * Math.sin(TAU * x + t) +
    0.3 * Math.sin(TAU * (x * 1.7 + y * 0.6) - 2 * t + 1.3) +
    0.2 * Math.sin(TAU * (x * 0.55 - y * 1.1) + t + 2.1);
  return ((p.range as number) / 2) * f;
}

const AURORA = shader({
  params: ['scale', 'tall', 'range'],
  wgsl: `let x = subject.x / params.scale;
let y = subject.y / params.tall;
let tau = ${f32(TAU)};
let t = ph * tau;
let f = 0.5 * sin(tau * x + t) + 0.3 * sin(tau * (x * 1.7 + y * 0.6) - 2.0 * t + 1.3) + 0.2 * sin(tau * (x * 0.55 - y * 1.1) + t + 2.1);
out.hue = select(params.range / 2.0 * f, 0.0, subject.cell > 0.5);`,
  at: (ph, s, p) => ({ hue: s.kind === 'cell' ? 0 : hueAt(ph, s.x, s.y, p) }),
  writes: ['hue'],
});

/**
 * A hue field drifting slowly over the sign: three sines across columns and rows, each turning a
 * whole number of times a loop so the loop closes. Ignores the order.
 */
export const aurora = modulator({
  name: 'aurora',
  about: 'Colors drift slowly across the sign in soft, shifting bands, like the northern lights.',
  params: {
    speed: {
      label: 'speed',
      min: 0.01,
      max: 1,
      step: 0.01,
      value: 0.05,
      unit: 'Hz',
      about: 'How many times a second the colors drift through a whole loop. Higher drifts faster.',
    },
    scale: {
      label: 'scale',
      min: 3,
      max: 120,
      step: 1,
      value: 24,
      unit: 'columns',
      about: 'How wide the bands of color are. Higher makes broader, gentler bands.',
    },
    range: {
      label: 'hue range',
      min: 0,
      max: 360,
      step: 1,
      value: 150,
      unit: '°',
      about:
        'How far round the color wheel the drift reaches, in degrees, centered on the message’s own color. Higher brings in more colors.',
    },
  },
  writes: ['hue'],
  on: 'dots',
  patch: (at, p) => {
    const bound = { scale: p.scale, tall: Math.max(1, at.board.rows), range: p.range };
    return patch<Subject, Pose>(
      1000 / p.speed,
      (phase, s) => (s.kind === 'cell' ? {} : { hue: hueAt(phase, s.x, s.y, bound) }),
      { writes: ['hue'] },
    );
  },
  shader: (at, p) =>
    AURORA(1000 / p.speed, { scale: p.scale, tall: Math.max(1, at.board.rows), range: p.range }),
});
