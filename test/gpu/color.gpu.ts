import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { shaderPatch } from '../../src/gpu/shader-patch.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import {
  add,
  type Channel,
  color,
  colorBurn,
  colorDodge,
  colorMode,
  darken,
  darkerColor,
  difference,
  divide,
  exclusion,
  hardLight,
  hardMix,
  hue,
  kit,
  lighten,
  lighterColor,
  linearBurn,
  linearLight,
  luminosity,
  mix,
  mixer,
  multiply,
  overlay,
  pinLight,
  saturation,
  screen,
  softLight,
  subtract,
  vividLight,
} from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { c: number[] };
const N = 129;
const cells: C[] = Array.from({ length: N }, (_, i) => ({ x: i / (N - 1) }));

/** A disc of one OKLab color moving across the row, its coverage soft at the edge. */
const disc = shaderPatch<C, P, { L: number; a: number; b: number; r: number }>(1000, {
  fields: { x: 'f32' },
  params: { L: 'f32', a: 'f32', b: 'f32', r: 'f32' },
  wgsl: 'let cov = clamp(0.5 + (params.r - abs(subject.x - phase)) * 20.0, 0.0, 1.0); out.c = array<f32, 4>(params.L * cov, params.a * cov, params.b * cov, cov);',
  at: (phase, s, _st, p) => {
    const cov = Math.min(1, Math.max(0, 0.5 + (p.r - Math.abs(s.x - phase)) * 20));
    return { c: [p.L * cov, p.a * cov, p.b * cov, cov] };
  },
  writes: ['c'],
});

type Cue = { L: number; a: number; b: number; r: number; weight?: number; role?: string };

export async function agreeArrays(
  device: GpuDevice,
  channel: () => Channel<number[]>,
  cues: Cue[],
  times: number[],
  axes: number,
): Promise<void> {
  const make = (engine: typeof mixer) => {
    // The CPU side runs without lanes: the general path is the reference lanes must match.
    const m = mix<C, P>(
      kit<P>({ c: channel() }),
      engine === mixer ? { engine, lanes: false } : { engine },
    );
    m.sync(0);
    for (const q of cues)
      m.cue({
        patch: disc.with({ L: q.L, a: q.a, b: q.b, r: q.r }),
        subjects: cells,
        weight: q.weight ?? 1,
        loop: true,
        ...(q.role === undefined ? {} : { role: q.role }),
      });
    return m;
  };
  const g = make(gpu({ device }));
  const c = make(mixer);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x }));
  g.sync(1);
  side.channel('c');
  await side.ready;
  for (const t of times) {
    g.sync(t);
    c.sync(t);
    const ch = side.channel('c');
    if (ch === null) throw new Error('the channel is not on the GPU');
    const got = await readBack(device, ch.buffer, ch.offset, N * axes * 4);
    cells.forEach((s, i) => {
      const want = c.probe(s).c;
      for (let a = 0; a < axes; a++)
        close(
          got[i * axes + a] as number,
          (want[a] ?? 0) as number,
          `t ${t} subject ${i} axis ${a}`,
          COLOR,
        );
    });
  }
}

/** A tenth of one 8-bit step: what f32 leaves after the trip through linear sRGB and back. */
const COLOR = 1e-3;

const RED = { L: 0.63, a: 0.22, b: 0.13 };
const BLUE = { L: 0.45, a: -0.03, b: -0.19 };
test('color(): two discs overlapping', (d) =>
  agreeArrays(
    d,
    () => color(),
    [
      { ...RED, r: 0.2037 },
      { ...BLUE, r: 0.3013, weight: 0.6 },
    ],
    [200, 450],
    4,
  ));
test('color(): two discs in a role', (d) =>
  agreeArrays(
    d,
    () => color(),
    [
      { ...RED, r: 0.2037, role: 'a' },
      { ...BLUE, r: 0.3013, role: 'a', weight: 0.5 },
    ],
    [200, 450],
    4,
  ));

const MODES = {
  multiply,
  screen,
  add,
  lighten,
  darken,
  overlay,
  softLight,
  hardLight,
  difference,
  colorDodge,
  colorBurn,
  exclusion,
  subtract,
  divide,
  linearBurn,
  vividLight,
  linearLight,
  pinLight,
  hardMix,
  hue,
  saturation,
  colorMode,
  luminosity,
  darkerColor,
  lighterColor,
};
for (const [name, mode] of Object.entries(MODES)) {
  const make = () => color((mode as () => Channel<number>)());
  const axes = make().rest?.length ?? 4;
  test(`color(${name}()): two discs`, (d) =>
    agreeArrays(
      d,
      make,
      [
        { ...RED, r: 0.2037 },
        { ...BLUE, r: 0.3013, weight: 0.6 },
      ],
      [200, 450],
      axes,
    ));
  test(`color(${name}()): a role and a third disc`, (d) =>
    agreeArrays(
      d,
      make,
      [
        { ...RED, r: 0.2037, role: 'a' },
        { ...BLUE, r: 0.2551 },
        { L: 0.8, a: 0.0, b: 0.1, r: 0.3013, role: 'a', weight: 0.5 },
      ],
      [200, 450],
      axes,
    ));
}
test('color(overlay({ layers: 2 })): a third layer is left off', (d) =>
  agreeArrays(
    d,
    () => color(overlay({ layers: 2 })),
    [
      { ...RED, r: 0.4019 },
      { ...BLUE, r: 0.4019 },
      { L: 0.8, a: 0, b: 0.1, r: 0.4019 },
    ],
    [200],
    10,
  ));
