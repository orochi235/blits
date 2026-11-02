import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { shaderPatch } from '../../src/gpu/shader-patch.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { type Channel, kit, max, min, mix, mixer, mul, norm, sum } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { v: number };
const N = 257;
const cells: C[] = Array.from({ length: N }, (_, i) => ({ x: i / (N - 1) }));

const wave = shaderPatch<C, P, { k: number }>(1000, {
  fields: { x: 'f32' },
  params: { k: 'f32' },
  wgsl: 'out.v = params.k * sin(6.2831853 * phase + subject.x * 3.0) + subject.x;',
  at: (phase, c, _s, p) => ({ v: p.k * Math.sin(6.2831853 * phase + c.x * 3) + c.x }),
  writes: ['v'],
});

type Cue = { k: number; weight?: number; role?: string; fade?: number; loop?: boolean };

/** Plays the same voices on the GPU and the CPU and compares every subject at `times`. */
async function agree(
  device: GpuDevice,
  channel: () => Channel<number>,
  cues: Cue[],
  times: number[],
) {
  const make = (engine: typeof mixer) => {
    const m = mix<C, P>(kit<P>({ v: channel() }), { engine });
    m.sync(0);
    for (const c of cues)
      m.cue({
        patch: wave.with({ k: c.k }),
        subjects: cells,
        weight: c.weight ?? 1,
        loop: c.loop ?? true,
        ...(c.role === undefined ? {} : { role: c.role }),
        ...(c.fade === undefined ? {} : { fade: { in: c.fade } }),
      });
    return m;
  };
  const g = make(gpu({ device }));
  const c = make(mixer);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x }));
  g.sync(1);
  side.channel('v');
  await side.ready;
  for (const t of times) {
    g.sync(t);
    c.sync(t);
    const ch = side.channel('v');
    if (ch === null) throw new Error('the channel is not on the GPU');
    const got = await readBack(device, ch.buffer, ch.offset, N * 4);
    cells.forEach((s, i) => close(got[i] as number, c.probe(s).v, `t ${t} subject ${i}`));
  }
}

const RULES: [string, () => Channel<number>][] = [
  ['sum', sum],
  ['mul', mul],
  ['max', max],
  ['min', () => min({ bounds: [-5, 5] })],
  ['min resting at 1', min],
  ['norm(2)', norm],
  ['norm(4)', () => norm({ power: 4 })],
];
for (const [name, ch] of RULES) {
  test(`${name}: one voice at full weight`, (d) => agree(d, ch, [{ k: 1 }], [130, 470]));
  test(`${name}: three voices at weights 1, 0.3, 0`, (d) =>
    agree(d, ch, [{ k: 1 }, { k: 0.5, weight: 0.3 }, { k: 2, weight: 0 }], [130, 470]));
  test(`${name}: two voices in a role with a third outside`, (d) =>
    agree(
      d,
      ch,
      [{ k: 1, role: 'a', weight: 0.6 }, { k: 0.2 }, { k: 2, role: 'a', weight: 0.7 }],
      [130, 470],
    ));
  test(`${name}: a voice fading in`, (d) =>
    agree(d, ch, [{ k: 1, fade: 400 }, { k: 0.5 }], [130, 330]));
  test(`${name}: a voice past its end`, (d) =>
    agree(d, ch, [{ k: 1, loop: false }, { k: 0.5 }], [1300]));
}
