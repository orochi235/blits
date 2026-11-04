import { gpu, gpuOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { type Keyframe, keys, kit, mix, mixer, patch, sum } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { s: number };
const cells: C[] = [{ x: 0 }, { x: 1 }, { x: 2 }];
const RAMP: Keyframe<P>[] = [
  { at: 0, delta: { s: 0 } },
  { at: 1, delta: { s: 2 } },
];

const make = (engine: typeof mixer) => {
  const k = kit<P>({ s: sum() });
  const m = mix<C, P>(k, { engine, name: 'idle' });
  m.sync(0);
  m.cue({ patch: keys<C, P>(1000, RAMP, { kit: k }), subjects: cells, loop: true });
  const h = m.cue({
    patch: patch<C, P>(0, (_, c) => ({ s: 10 + c.x }), { writes: ['s'] }),
    subjects: cells,
    weight: 0,
  });
  return { m, h };
};

async function agrees(device: GpuDevice, g: ReturnType<typeof make>, c: ReturnType<typeof make>) {
  const ch = gpuOf(g.m).channel('s');
  if (ch === null) return false;
  const got = await readBack(device, ch.buffer, ch.offset, cells.length * 4);
  cells.forEach((s, i) => {
    close(got[i] as number, c.m.probe(s).s, `subject ${i}`);
  });
  return true;
}

test('idle: a voice at weight 0 leaves its channel on the GPU, and raised, never a stale fold', async (d) => {
  const g = make(gpu({ device: d }));
  const c = make(mixer);
  const side = gpuOf(g.m);
  side.subjects(cells, (s) => ({ x: s.x }));
  side.channel('s');
  await side.ready;
  g.m.sync(300);
  c.m.sync(300);
  if (!(await agrees(d, g, c)))
    throw new Error('s is not on the GPU with the fn voice at weight 0');
  g.h.weight = 0.5;
  c.h.weight = 0.5;
  await agrees(d, g, c);
});
