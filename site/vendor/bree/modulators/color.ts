import { oklab, type Patch, patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import type { ColorsParam } from '../params.js';
import { cycleMs, depth, modulator, phasePerStep, RATE, unitAt } from './modulator.js';
import { f32, type ModShader, RANK, rankAt, SHAPES, shader, unitOf } from './shader.js';

/** The most colors a palette folds on the GPU with; one with more stays on the CPU. */
const MOST = 8;
const SAW = SHAPES.indexOf('saw');
const swatch = (k: number) => [`c${k}L`, `c${k}a`, `c${k}b`];

/** The step a palette of `n` colors is on at `u` cycles in. */
const stepAt = (u: number, n: number) => Math.min(n - 1, Math.floor(unitOf(SAW, u - 0.5) * n));

const PALETTE = shader({
  params: ['n', 'phase', 'by', 'cols', ...Array.from({ length: MOST }, (_, k) => swatch(k)).flat()],
  wgsl: `var swatches = array<vec3f, ${MOST}>(${Array.from(
    { length: MOST },
    (_, k) =>
      `vec3f(${swatch(k)
        .map((n) => `params.${n}`)
        .join(', ')})`,
  ).join(', ')});
let k = min(params.n - 1.0, floor(bree_unit(${f32(SAW)}, ph + ${RANK} * params.phase - 0.5) * params.n));
let c = swatches[i32(k)];
out.tint = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
if (subject.cell < 0.5) { out.tint = array<f32, 4>(c.x, c.y, c.z, 1.0); }`,
  at: (ph, s, p) => {
    if (s.kind === 'cell') return { tint: [0, 0, 0, 0] };
    const k = stepAt(ph + rankAt(p, s) * (p.phase as number), p.n as number);
    return { tint: [...swatch(k).map((n) => p[n] as number), 1] };
  },
  writes: ['tint'],
});

/** Tint stepping through its colors in order, each held for one step. */
export const palette = modulator({
  name: 'palette',
  about: 'Dots step through a list of colors.',
  params: {
    colors: {
      label: 'colors',
      colors: [0xff3b30, 0xffcc00, 0x34c759, 0x0a84ff],
      about:
        'The colors the dots step through, in order. Add or remove swatches to change the list.',
    } as ColorsParam,
    step: {
      label: 'step',
      min: 50,
      max: 2000,
      step: 10,
      value: 400,
      unit: 'ms',
      about: 'How long each color shows before the next. Higher steps more slowly.',
    },
    phase: phasePerStep(0.05),
  },
  writes: ['tint'],
  on: 'dots',
  patch: (_at, p, rank) => {
    const tints = p.colors.map(oklab);
    const n = Math.max(1, tints.length);
    return patch<Subject, Pose>(
      p.step * n,
      (phase, subject) => {
        const tint = tints[stepAt(phase + rank(subject) * p.phase, n)];
        return tint ? { tint } : {};
      },
      { writes: ['tint'] },
    );
  },
  shader: (_at, p, rank) => {
    const n = p.colors.length;
    if (!rank || n === 0 || n > MOST) return null;
    const swatches: Record<string, number> = {};
    for (let k = 0; k < MOST; k++) {
      const lab = oklab(p.colors[k] ?? 0);
      swatch(k).forEach((name, a) => {
        swatches[name] = lab[a] as number;
      });
    }
    return PALETTE(p.step * n, { n, phase: p.phase, ...rank, ...swatches });
  },
});

/** The two colors a two-color blend runs between, in OKLab: its first two, or its first twice. */
const endsOf = (colors: readonly number[]): [number[], number[]] => [
  oklab(colors[0] ?? 0xffffff),
  oklab(colors[1] ?? colors[0] ?? 0xffffff),
];

/** The tint `k` of the way from `a` to `b`, each an OKLab color whole. */
const blend = (a: readonly number[], b: readonly number[], k: number) =>
  a.map((v, i) => v + ((b[i] ?? v) - v) * k);

const TWO = shader({
  params: ['aL', 'aa', 'ab', 'bL', 'ba', 'bb', 'depth', 'phase', 'by', 'cols'],
  wgsl: `let k = bree_unit(0.0, ph + ${RANK} * params.phase) * params.depth;
out.tint = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
if (subject.cell < 0.5) {
  out.tint = array<f32, 4>(params.aL + (params.bL - params.aL) * k, params.aa + (params.ba - params.aa) * k, params.ab + (params.bb - params.ab) * k, 1.0);
}`,
  at: (ph, s, p) => {
    if (s.kind === 'cell') return { tint: [0, 0, 0, 0] };
    const k = unitOf(0, ph + rankAt(p, s) * (p.phase as number)) * (p.depth as number);
    return { tint: blend([p.aL, p.aa, p.ab, 1] as number[], [p.bL, p.ba, p.bb, 1] as number[], k) };
  },
  writes: ['tint'],
});

/** Tint blending between the first two of its colors along a sine. */
export const twoColor = modulator({
  name: 'two-color',
  about: 'Dots blend back and forth between two colors.',
  params: {
    colors: {
      label: 'colors',
      colors: [0xff3b30, 0x0a84ff],
      about: 'The two colors the dots blend between. Only the first two are used.',
    } as ColorsParam,
    rate: RATE,
    depth: depth(
      1,
      'How far toward the second color the blend reaches. At 1 it goes all the way; lower stays nearer the first.',
    ),
    phase: phasePerStep(0.01),
  },
  writes: ['tint'],
  on: 'dots',
  patch: (_at, p, rank) => {
    const [a, b] = endsOf(p.colors);
    return patch<Subject, Pose>(
      cycleMs(p.rate),
      (phase, subject) => {
        const u = unitAt('sine', phase + rank(subject) * p.phase);
        return { tint: blend(a, b, u * p.depth) };
      },
      { writes: ['tint'] },
    );
  },
  shader: (_at, p, rank) => {
    if (!rank) return null;
    const [[aL = 0, aa = 0, ab = 0], [bL = 0, ba = 0, bb = 0]] = endsOf(p.colors);
    return TWO(cycleMs(p.rate), {
      aL,
      aa,
      ab,
      bL,
      ba,
      bb,
      depth: p.depth,
      phase: p.phase,
      ...rank,
    });
  },
});

const SOLID = shader({
  params: ['L', 'a', 'b'],
  wgsl: 'out.tint = array<f32, 4>(params.L, params.a, params.b, 1.0);',
  at: (_ph, _s, p) => ({ tint: [p.L as number, p.a as number, p.b as number, 1] }),
  writes: ['tint'],
});

/**
 * Tint holding `hex` on every subject for `ms`: a scene's message color. On the gpu engine (`gpu`)
 * it is a shader patch, so the color folds on the GPU with the rest of the scene.
 */
export function solid(ms: number, hex: number, gpu: boolean): Patch<Subject, Pose> | ModShader {
  const tint = oklab(hex);
  if (gpu) return SOLID(ms, { L: tint[0] ?? 0, a: tint[1] ?? 0, b: tint[2] ?? 0 });
  return patch<Subject, Pose>(ms, () => ({ tint }), { writes: ['tint'] });
}
