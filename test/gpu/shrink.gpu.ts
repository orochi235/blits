import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { shaderPatch } from '../../src/gpu/shader-patch.js';
import { color, kit, mix, mixer, sum } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { tint: number[]; v: number };
const cells: C[] = Array.from({ length: 64 }, (_, i) => ({ x: i / 63 }));
const tint = shaderPatch<C, P>(300, {
  wgsl: 'out.tint = array<f32, 4>(0.5, 0.1, 0.0, 1.0);',
  at: () => ({ tint: [0.5, 0.1, 0, 1] }),
  writes: ['tint'],
});
const wave = shaderPatch<C, P>(1000, {
  fields: { x: 'f32' },
  wgsl: 'out.v = phase + subject.x;',
  at: (phase, c) => ({ v: phase + c.x }),
  writes: ['v'],
});

test('a kernel compiles once the channels it folds shrink', async (device) => {
  const make = (engine: typeof mixer) => {
    const m = mix<C, P>(kit<P>({ tint: color(), v: sum() }), { engine });
    m.sync(0);
    m.cue({ patch: tint, subjects: cells });
    m.cue({ patch: wave, subjects: cells, loop: true });
    return m;
  };
  const g = make(gpu({ device }));
  const c = make(mixer);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x }));
  g.sync(100);
  side.channel('v');
  await side.ready;
  // The tint voice has ended: only v is folded now, by a kernel that still holds tint's shader.
  g.sync(600);
  c.sync(600);
  side.channel('v');
  await side.ready;
  g.sync(650);
  c.sync(650);
  const ch = side.channel('v');
  if (ch === null) throw new Error('v is not on the GPU');
  const got = await readBack(device, ch.buffer, ch.offset, cells.length * 4);
  cells.forEach((s, i) => {
    close(got[i] as number, c.probe(s).v, `subject ${i}`);
  });
});
