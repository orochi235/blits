import { gpu, gpuOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { kit, mix, mixer, spring, sum } from '../../src/index.js';
import { motionOf } from '../../src/motion.js';
import type { Motions } from '../../src/motions.js';
import { close, readBack, test } from './harness.js';

interface C {
  id: number;
}
type P = { x: number };
const CELLS: C[] = Array.from({ length: 33 }, (_, id) => ({ id }));
const K = kit<P>({ x: sum() });

/** An unstaggered spring on a gpu mix and on a CPU mix, cued at 0 on `subjects`. */
async function twins(device: GpuDevice, cue: object, subjects: C[]) {
  const build = () =>
    spring<C, P>('x', { from: (c) => c.id % 5, to: 20, stiffness: 180, damping: 12 });
  const gp = build();
  const cp = build();
  const g = mix<C, P>(K, { engine: gpu({ device }), name: 'unread' });
  const c = mix<C, P>(K, { engine: mixer, name: 'unread' });
  for (const [m, p] of [
    [g, gp],
    [c, cp],
  ] as const) {
    m.sync(0);
    m.cue({ patch: p, subjects, ...cue });
  }
  const side = gpuOf(g);
  side.subjects(CELLS, () => ({}));
  side.channel('x');
  await side.ready;
  const check = async (t: number) => {
    const ch = side.channel('x');
    if (ch === null) throw new Error(`x is not on the GPU at ${t}`);
    const got = await readBack(device, ch.buffer, ch.offset, CELLS.length * 4);
    CELLS.forEach((s, i) => {
      close(got[i] as number, c.probe(s).x, `t ${t} subject ${s.id}`);
    });
  };
  return { g, c, gp, cp, check };
}

test("unread: an untimed retarget at a fade in's weight 0 waits for the first read past it", async (d) => {
  const { g, c, gp, cp, check } = await twins(d, { fade: { in: 400 } }, CELLS);
  for (const s of CELLS) for (const p of [gp, cp]) p.to(s, 60 + (s.id % 3));
  await check(0);
  for (const t of [200, 600, 1400]) {
    g.sync(t);
    c.sync(t);
    await check(t);
  }
});

test('unread: a retarget of a subject the voice does not reach stays pending', async (d) => {
  const even = CELLS.filter((s) => s.id % 2 === 0);
  const { g, c, gp, cp, check } = await twins(d, {}, even);
  g.sync(100);
  c.sync(100);
  const odd = CELLS[1] as C;
  for (const p of [gp, cp]) p.to(odd, 50);
  await check(100);
  for (const [p, where] of [
    [gp, 'GPU'],
    [cp, 'CPU'],
  ] as const) {
    const motions = motionOf<C>(p) as Motions<C>;
    const slot = motions.known(odd) as number;
    if (motions.pending?.[slot]?.length !== 1)
      throw new Error(`the ${where} mix committed the unreached subject's retarget`);
  }
});
