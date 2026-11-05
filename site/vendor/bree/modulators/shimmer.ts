import { patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import type { Placed } from '../orders.js';
import { bump, modulator } from './modulator.js';
import { type Bound, f32, shader } from './shader.js';

/** The longest a glint takes to cross the sign, ms. */
const SWEEP = 1100;
/**
 * At the glint's middle: how much the halos grow, how much color drains toward white, and how
 * brightly it catches the dots nothing lights. A gain above 1 draws no brighter, so it lifts these.
 */
const GLOW = 2.5;
const PALE = 0.65;
const SHEEN = 0.3;

/** The glint's strength at a dot at `ph`: a bump across its width while it sweeps, else 0. */
const glintAt = (ph: number, x: number, y: number, p: Bound) => {
  const sweep = p.sweep as number;
  if (!(ph < sweep)) return 0;
  const from = p.from as number;
  const lean = ((p.rows as number) - 1 - y) * (p.slope as number);
  return bump((x + lean - (from + ((p.to as number) - from) * (ph / sweep))) / (p.width as number));
};

const SHIMMER = shader({
  params: ['rows', 'slope', 'from', 'to', 'sweep', 'width'],
  wgsl: `var k = 0.0;
if (subject.cell < 0.5 && ph < params.sweep) {
  let lean = (params.rows - 1.0 - subject.y) * params.slope;
  k = bree_bump((subject.x + lean - (params.from + (params.to - params.from) * (ph / params.sweep))) / params.width);
}
out.lit = ${f32(SHEEN)} * k;
out.glow = 1.0 + ${f32(GLOW)} * k;
out.chroma = 1.0 - ${f32(PALE)} * k;`,
  at: (ph, s, p) => {
    const k = s.kind === 'cell' ? 0 : glintAt(ph, s.x, s.y, p);
    return { lit: SHEEN * k, glow: 1 + GLOW * k, chroma: 1 - PALE * k };
  },
  writes: ['lit', 'glow', 'chroma'],
});

/** What a glint across `at`'s board reads. */
const boundOf = (at: Placed, p: { every: number; width: number; angle: number }) => {
  const { cols, rows } = at.board;
  const slope = Math.tan((p.angle * Math.PI) / 180);
  return {
    rows,
    slope,
    from: -p.width - Math.max(0, (rows - 1) * slope),
    to: cols - 1 + p.width - Math.min(0, (rows - 1) * slope),
    sweep: Math.min(p.every, SWEEP) / p.every,
    width: p.width,
  };
};

/** A leaning glint sweeping across the sign at the start of each cycle. Loops; ignores the order. */
export const shimmer = modulator({
  name: 'shimmer',
  about: 'A slanted glint of light sweeps across the sign now and then.',
  params: {
    every: {
      label: 'how often',
      min: 800,
      max: 15000,
      step: 100,
      value: 4000,
      unit: 'ms',
      about: 'How long from one glint to the next. Higher waits longer between them.',
    },
    width: {
      label: 'width',
      min: 1,
      max: 20,
      step: 0.5,
      value: 3.5,
      unit: 'columns',
      about: 'How wide the glint is. Higher makes a broader sweep of light.',
    },
    angle: {
      label: 'angle',
      min: -60,
      max: 60,
      step: 1,
      value: 30,
      unit: '°',
      about:
        'How far the glint leans from upright. At 0 it stands straight; above 0 its top leans right, below 0 left.',
    },
  },
  writes: ['lit', 'glow', 'chroma'],
  on: 'dots',
  patch: (at, p) => {
    const bound = boundOf(at, p);
    return patch<Subject, Pose>(
      p.every,
      (phase, s) => {
        if (s.kind === 'cell') return {};
        const k = glintAt(phase, s.x, s.y, bound);
        return { lit: SHEEN * k, glow: 1 + GLOW * k, chroma: 1 - PALE * k };
      },
      { writes: ['lit', 'glow', 'chroma'] },
    );
  },
  shader: (at, p) => SHIMMER(p.every, boundOf(at, p)),
});
