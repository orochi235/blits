import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { shaderPatch } from '../../src/gpu/shader-patch.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { angle, kit, mix, mixer } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  i: number;
}
type P = { hue: number };
const cells: C[] = [{ i: 0 }, { i: 1 }];

const held = shaderPatch<C, P, { k: number }>(1000, {
  params: { k: 'f32' },
  wgsl: 'out.hue = params.k;',
  at: (_phase, _c, _s, p) => ({ hue: p.k }),
  writes: ['hue'],
});

type Cue = { k: number; weight?: number; role?: string };

/** Holds each cue's angle on the GPU and the CPU and compares them exactly. */
async function agree(device: GpuDevice, cues: Cue[]) {
  const make = (engine: typeof mixer) => {
    const m = mix<C, P>(kit<P>({ hue: angle() }), { engine });
    m.sync(0);
    for (const c of cues)
      m.cue({
        patch: held.with({ k: c.k }),
        subjects: cells,
        weight: c.weight ?? 1,
        loop: true,
        ...(c.role === undefined ? {} : { role: c.role }),
      });
    return m;
  };
  const g = make(gpu({ device }));
  const c = make(mixer);
  const side = gpuOf(g);
  side.subjects(cells, () => ({}));
  g.sync(1);
  side.channel('hue');
  await side.ready;
  g.sync(100);
  c.sync(100);
  const ch = side.channel('hue');
  if (ch === null) throw new Error('hue is not on the GPU');
  const got = await readBack(device, ch.buffer, ch.offset, cells.length * 4);
  cells.forEach((s, i) => {
    close(got[i] as number, c.probe(s).hue, `subject ${i}`, 0);
  });
}

// shortWay takes a half turn to -turn/2 from either side, as Math.round takes halves up.
for (const k of [180, -180, 540, -540, 179.5, -179.5, 720])
  test(`angle: ${k} wraps as shortWay does`, (d) => agree(d, [{ k }]));
test('angle: two voices summing past a half turn', (d) =>
  agree(d, [{ k: 120 }, { k: 100, weight: 0.5 }]));
test('angle: a role blends its members the short way round', (d) =>
  agree(d, [
    { k: 170, role: 'a', weight: 0.5 },
    { k: -170, role: 'a', weight: 0.5 },
  ]));
test('angle: a role of unequal weights, the short way across 0', (d) =>
  agree(d, [
    { k: 350, role: 'a', weight: 0.3 },
    { k: 20, role: 'a', weight: 0.9 },
  ]));
