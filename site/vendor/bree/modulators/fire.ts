import { oklab, patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import { hash } from '../hash.js';
import { modulator, OUTWEIGH, outweigh } from './modulator.js';
import { type Bound, f32, shader } from './shader.js';

/** Bottom to top: embers, flame, tips. */
const STOPS = [0x9e0f06, 0xe8330c, 0xff7a12, 0xffd23f].map(oklab);
/** How far the flames rise in one loop, in rows, and the noise lattice's height in rows. */
const RISE = 24;
const CELL = 1.5;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise at (`x`, `y`) in lattice cells, 0 to 1, repeating every `period` cells down `y`. */
function noise(x: number, y: number, period: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const at = (i: number, j: number) => hash(i, ((j % period) + period) % period, period);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
  const low = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
  return top + (low - top) * fy;
}

function ramp(u: number): number[] {
  const x = Math.min(1, Math.max(0, u)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const a = STOPS[i] as number[];
  const b = STOPS[i + 1] as number[];
  return a.map((v, k) => v + ((b[k] as number) - v) * (x - i));
}

const PERIOD = RISE / CELL;

/** A dot's flicker at `phase`: its gain, and its heat's color, outweighing the scene's. */
function poseAt(phase: number, x: number, sy: number, p: Bound): Partial<Pose> {
  const intensity = p.intensity as number;
  const y = (sy + phase * RISE) / CELL;
  const n = 0.65 * noise(x / 2.5, y, PERIOD) + 0.35 * noise(x / 1.2 + 31, y * 2, PERIOD * 2);
  const up = 1 - sy / (p.rows as number);
  const ragged = 0.55 + 0.45 * up;
  return {
    gain: 1 - intensity * ragged * (1 - n) ** 1.6,
    tint: outweigh(ramp(up + (n - 0.5) * 0.6 * intensity)),
  };
}

const vec = (c: number[]) => `vec4f(${c.map(f32).join(', ')})`;

const FIRE = shader({
  params: ['rows', 'intensity'],
  wgsl: `out.gain = 1.0;
out.tint = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
if (subject.cell < 0.5) {
  let y = (subject.y + ph * ${f32(RISE)}) / ${f32(CELL)};
  let n = 0.65 * bree_noise(subject.x / 2.5, y, ${PERIOD}) + 0.35 * bree_noise(subject.x / 1.2 + 31.0, y * 2.0, ${PERIOD * 2});
  let up = 1.0 - subject.y / params.rows;
  let ragged = 0.55 + 0.45 * up;
  out.gain = 1.0 - params.intensity * ragged * pow(1.0 - n, 1.6);
  let x = clamp(up + (n - 0.5) * 0.6 * params.intensity, 0.0, 1.0) * ${f32(STOPS.length - 1)};
  let i = min(${STOPS.length - 2}, i32(floor(x)));
  var stops = array<vec4f, ${STOPS.length}>(${STOPS.map(vec).join(', ')});
  let c = (stops[i] + (stops[i + 1] - stops[i]) * (x - f32(i))) * ${f32(OUTWEIGH)};
  out.tint = array<f32, 4>(c.x, c.y, c.z, c.w);
}`,
  at: (ph, s, p) => (s.kind === 'cell' ? { gain: 1, tint: [0, 0, 0, 0] } : poseAt(ph, s.x, s.y, p)),
  writes: ['gain', 'tint'],
});

/**
 * Lit dots colored by height, deep red at the bottom row to yellow at the top, flickering in gain
 * and heat along noise that rises through the rows. Loops; ignores the order.
 */
export const fire = modulator({
  name: 'fire',
  about: 'Dots burn in a rising flicker, deep red at the bottom to yellow at the top.',
  params: {
    heat: {
      label: 'heat',
      min: 0.5,
      max: 30,
      step: 0.5,
      value: 6,
      unit: 'rows/s',
      about: 'How fast the flames rise through the rows. Higher burns faster and wilder.',
    },
    intensity: {
      label: 'intensity',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.6,
      about:
        'How hard the flames flicker. At 0 the dots hold their colors steady; higher lets them gutter and flare.',
    },
  },
  writes: ['gain', 'tint'],
  on: 'dots',
  patch: (at, p) => {
    const bound = { rows: Math.max(1, at.board.rows - 1), intensity: p.intensity };
    return patch<Subject, Pose>(
      (RISE / p.heat) * 1000,
      (phase, s) => (s.kind === 'cell' ? {} : poseAt(phase, s.x, s.y, bound)),
      { writes: ['gain', 'tint'] },
    );
  },
  shader: (at, p) =>
    FIRE((RISE / p.heat) * 1000, { rows: Math.max(1, at.board.rows - 1), intensity: p.intensity }),
});
