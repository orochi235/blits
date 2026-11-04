import { gpu, gpuOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { type Keyframe, keys, kit, mix, mixer, sum } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { s: number };
const cells: C[] = [{ x: 0 }, { x: 1 }];
const RAMP: Keyframe<P>[] = [
  { at: 0, delta: { s: 0 } },
  { at: 1, delta: { s: 2 } },
];
const HELD: Keyframe<P>[] = [{ at: 0, delta: { s: 5 } }];

const make = (engine: typeof mixer) => {
  const k = kit<P>({ s: sum() });
  const m = mix<C, P>(k, { engine, name: 'side' });
  m.sync(0);
  m.cue({ patch: keys<C, P>(1000, RAMP, { kit: k }), subjects: cells, loop: true });
  return { m, k };
};
type Made = ReturnType<typeof make>;

/** Reads `s` from the GPU and compares each subject with the CPU mix `c`. */
async function check(device: GpuDevice, g: Made, c: Made): Promise<void> {
  const ch = gpuOf(g.m).channel('s');
  if (ch === null) throw new Error('s is not on the GPU');
  const got = await readBack(device, ch.buffer, ch.offset, cells.length * 4);
  cells.forEach((s, i) => {
    close(got[i] as number, c.m.probe(s).s, `subject ${i}`);
  });
}

test('side: a voice cued without a sync shows in channel()', async (d) => {
  const g = make(gpu({ device: d }));
  const c = make(mixer);
  gpuOf(g.m).subjects(cells, (s) => ({ x: s.x }));
  gpuOf(g.m).channel('s');
  await gpuOf(g.m).ready;
  g.m.sync(300);
  c.m.sync(300);
  await check(d, g, c);
  for (const x of [g, c])
    x.m.cue({ patch: keys<C, P>(1000, HELD, { kit: x.k }), subjects: cells, loop: true });
  await check(d, g, c);
});

test('side: a read during compile, then after ready in the same frame', async (d) => {
  const g = make(gpu({ device: d }));
  const c = make(mixer);
  const side = gpuOf(g.m);
  side.subjects(cells, (s) => ({ x: s.x }));
  g.m.sync(300);
  c.m.sync(300);
  if (side.channel('s') !== null) throw new Error('s was on the GPU before its kernel compiled');
  await side.ready;
  await check(d, g, c);
});
