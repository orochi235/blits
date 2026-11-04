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
  ink,
  type Keyframe,
  keys,
  kit,
  lighten,
  lighterColor,
  linearBurn,
  linearLight,
  luminosity,
  type Mix,
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

/** Cues a disc per cue, each a voice on `m`. */
const discs = (cues: Cue[]) => (m: Mix<C, P>) => {
  for (const q of cues)
    m.cue({
      patch: disc.with({ L: q.L, a: q.a, b: q.b, r: q.r }),
      subjects: cells,
      weight: q.weight ?? 1,
      loop: true,
      ...(q.role === undefined ? {} : { role: q.role }),
    });
};

async function agreeArrays(
  device: GpuDevice,
  channel: () => Channel<number[]>,
  cue: Cue[] | ((m: Mix<C, P>, k: { c: Channel<number[]> }) => void),
  times: number[],
  axes: number,
): Promise<void> {
  const make = (engine: typeof mixer) => {
    const k = kit<P>({ c: channel() });
    const m = mix<C, P>(k, { engine, name: 'color' });
    m.sync(0);
    if (Array.isArray(cue)) discs(cue)(m);
    else cue(m, k);
    return m;
  };
  const g = make(gpu({ device }));
  const c = make(mixer);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x }));
  side.channel('c');
  await side.ready;
  // Folds again at the time the mix is at, which a sync to that time would not.
  side.subjects(cells, (s) => ({ x: s.x }));
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

/** Premultiplied OKLab: `[L, a, b]` at coverage `w`. */
const lab = (L: number, a: number, b: number, w = 1) => [L * w, a * w, b * w, w];
type Keyed = { stops: Keyframe<P>[]; weight?: number; role?: string };
const keyed = (voices: Keyed[]) => (m: Mix<C, P>, k: { c: Channel<number[]> }) => {
  for (const v of voices)
    m.cue({
      patch: keys<C, P>(1000, v.stops, { kit: k }),
      subjects: cells,
      weight: v.weight ?? 1,
      loop: true,
      ...(v.role === undefined ? {} : { role: v.role }),
    });
};
const KEY_TIMES = [0, 130, 499, 500, 501, 870, 2300];
/** From a hue below 0 to one above it, the short way across 0, then on to blue. */
const ACROSS: Keyframe<P>[] = [
  { at: 0, delta: { c: lab(0.6, 0.12, -0.06) } },
  { at: 0.5, delta: { c: lab(0.7, 0.1, 0.08, 0.6) }, ease: 'ease-in' },
  { at: 1, delta: { c: lab(0.45, -0.03, -0.19) } },
];
const GRAYED: Keyframe<P>[] = [
  { at: 0, delta: { c: lab(0.63, 0.22, 0.13) } },
  { at: 0.5, delta: { c: lab(0.5, 0, 0) } },
  { at: 1, delta: { c: lab(0.45, -0.03, -0.19, 0.8) }, ease: 'ease-out' },
];
const KEYED = {
  'color(multiply())': () => color(multiply()),
  'ink(screen())': () => ink(screen()),
  'color(overlay())': () => color(overlay()),
  'ink(overlay())': () => ink(overlay()),
};
for (const [name, make] of Object.entries(KEYED)) {
  const axes = make().rest?.length ?? 4;
  test(`${name}: keys crossing hue 0`, (d) =>
    agreeArrays(d, make, keyed([{ stops: ACROSS }]), KEY_TIMES, axes));
  test(`${name}: keys through gray`, (d) =>
    agreeArrays(d, make, keyed([{ stops: GRAYED }]), KEY_TIMES, axes));
  test(`${name}: a role of two keys voices`, (d) =>
    agreeArrays(
      d,
      make,
      keyed([
        { stops: ACROSS, role: 'a' },
        { stops: GRAYED, role: 'a', weight: 0.5 },
      ]),
      KEY_TIMES,
      axes,
    ));
}
