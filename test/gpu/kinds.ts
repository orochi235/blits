import { shaderPatch } from '../../src/gpu/shader-patch.js';
import {
  color,
  glide,
  type Kit,
  keys,
  kit,
  overlay,
  spring,
  sum,
  tween,
  wave,
} from '../../src/index.js';
import { type C, CELLS, type Kind, type Moving, N } from './agree.js';

const DURATION = 1000;

const shader = shaderPatch<C, { v: number }, { k: number }>(DURATION, {
  fields: { id: 'f32' },
  params: { k: 'f32' },
  wgsl: 'out.v = params.k * sin(6.2831853 * phase + subject.id * 0.1) + subject.id * 0.01;',
  at: (phase, c, _s, p) => ({ v: p.k * Math.sin(6.2831853 * phase + c.id * 0.1) + c.id * 0.01 }),
  writes: ['v'],
});

/** A band of one OKLab color sweeping the row, so which layer lies over which shows. */
const disc = shaderPatch<C, { c: number[] }, { L: number; a: number; b: number }>(DURATION, {
  fields: { x: 'f32' },
  params: { L: 'f32', a: 'f32', b: 'f32' },
  wgsl: 'let cov = clamp(0.5 + (0.35 - abs(subject.x - phase)) * 20.0, 0.0, 1.0); out.c = array<f32, 4>(params.L * cov, params.a * cov, params.b * cov, cov);',
  at: (phase, s, _st, p) => {
    const x = s.id / (N - 1);
    const cov = Math.min(1, Math.max(0, 0.5 + (0.35 - Math.abs(x - phase)) * 20));
    return { c: [p.L * cov, p.a * cov, p.b * cov, cov] };
  },
  writes: ['c'],
});
const COLORS = [
  { L: 0.63, a: 0.22, b: 0.13 },
  { L: 0.45, a: -0.03, b: -0.19 },
  { L: 0.8, a: 0.0, b: 0.1 },
  { L: 0.5, a: 0.15, b: -0.1 },
  { L: 0.7, a: -0.12, b: 0.08 },
];

type V = { v: number };
const sums = () => kit<V>({ v: sum() }) as unknown as Kit<never>;
export const KINDS: Kind[] = [
  {
    name: 'shaderPatch',
    kit: sums,
    channel: 'v',
    period: DURATION,
    loops: true,
    patch: (k) => shader.with({ k: 1 + k }),
  },
  {
    name: 'wave',
    kit: sums,
    channel: 'v',
    period: DURATION,
    loops: true,
    patch: (k, kt) =>
      wave<C, { v: number }>(DURATION, {
        depth: { v: 1 + k },
        phase: 0.1 * k,
        kit: kt as unknown as Kit<{ v: number }>,
      }),
  },
  {
    name: 'keys',
    kit: sums,
    channel: 'v',
    period: DURATION,
    loops: true,
    patch: (k, kt) =>
      keys<C, { v: number }>(
        DURATION,
        [
          { at: 0, delta: { v: 0 } },
          { at: 0.6, delta: { v: 2 + k }, ease: 'ease-in' },
          { at: 1, delta: { v: -1 } },
        ],
        { kit: kt as unknown as Kit<{ v: number }> },
      ),
  },
];
/** A stacked color, where a role's place among the layers is where its leader is. */
export const STACKED: Kind = {
  name: 'shaderPatch on a stacked color',
  kit: () => kit<{ c: number[] }>({ c: color(overlay()) }) as unknown as Kit<never>,
  channel: 'c',
  period: DURATION,
  loops: true,
  tolerance: 1e-3,
  patch: (k) => disc.with(COLORS[k % COLORS.length] as { L: number; a: number; b: number }),
};

/** A motion kind, and how a script retargets one of its patches: a new goal, or a push for a glide. */
export interface Motion extends Kind {
  move(p: Moving, s: C, k: number, at?: number): void;
}

export const MOTIONS: Motion[] = [
  {
    name: 'spring',
    kit: sums,
    channel: 'v',
    period: 0,
    loops: false,
    patch: (k) =>
      spring<C, V>('v', {
        from: (c) => c.id % 7,
        to: (c) => 10 + k + (c.id % 5),
        stiffness: 180,
        damping: 12,
      }),
    move: (p, s, k, at) => p.to?.(s, 30 - s.id * 0.1 + k, at),
  },
  {
    name: 'tween',
    kit: sums,
    channel: 'v',
    period: 0,
    loops: false,
    patch: (k) =>
      tween<C, V>('v', {
        from: (c) => c.id % 9,
        to: (c) => 50 + k - (c.id % 4),
        ms: (c) => 300 + (c.id % 5) * 40,
        ease: 'ease-in-out',
      }),
    move: (p, s, k, at) => p.to?.(s, 7 + k + (s.id % 3), at),
  },
  {
    name: 'bounded glide',
    kit: sums,
    channel: 'v',
    period: 0,
    loops: false,
    // Its branch inside a run turns on time.
    near: true,
    patch: (k) =>
      glide<C, V>('v', {
        from: (c) => [50, 50, 120, -30][c.id % 4] as number,
        velocity: (c) => ([10 + c.id * 0.37, 400, -20, 10][c.id % 4] as number) + k * 5,
        bounds: [0, 100],
      }),
    move: (p, s, k, at) => p.push?.(s, (s.id % 2 === 0 ? 300 : -250) + k * 10, at),
  },
];

/** Moves every subject `keep` takes on each listed cue's patch, at subject time `at` if given. */
export const moving =
  (kind: Motion, cues: number[], keep: (i: number) => boolean, at?: number) =>
  (_h: unknown, p: Moving[]) => {
    for (const k of cues) {
      const patch = p[k];
      if (patch !== undefined)
        CELLS.forEach((s, i) => {
          if (keep(i)) kind.move(patch, s, k, at);
        });
    }
  };
