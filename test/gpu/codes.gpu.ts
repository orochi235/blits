import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { keys, kit, mix, mixer, sum } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  i: number;
}
type P = { x: number };
// Past the subjects whose level codes take a buffer of their own, sent at cue.
const cells: C[] = Array.from({ length: 40_000 }, (_, i) => ({ i }));
const rise = keys<C, P>(1000, [
  { at: 0, delta: { x: 0 } },
  { at: 1, delta: { x: 10 } },
]);

test("staggered voices over 40,000 subjects, one starting later and one ending first, fold as the CPU's do", async (device) => {
  const make = (engine: typeof mixer) => {
    const m = mix<C, P>(kit<P>({ x: sum() }), { engine });
    m.sync(0);
    m.cue({ patch: rise, subjects: cells, stagger: (c) => (c.i % 256) * 4 });
    m.cue({
      patch: rise,
      subjects: cells,
      stagger: (c) => (c.i % 300) * 3,
      start: 700,
      fade: { in: 200 },
    });
    return m;
  };
  const g = make(gpu({ device }));
  const c = make(mixer);
  const side = gpuOf(g);
  side.subjects(cells, () => ({}));
  g.sync(1);
  side.channel('x');
  await side.ready;
  for (const t of [300.5, 900.5, 2300.5]) {
    g.sync(t);
    c.sync(t);
    const ch = side.channel('x');
    if (ch === null) throw new Error(`x is not on the GPU at ${t}`);
    const got = await readBack(device, ch.buffer, ch.offset, cells.length * 4);
    cells.forEach((s, i) => {
      close(got[i] as number, c.probe(s).x, `subject ${i} at ${t}`);
    });
  }
});

test('a fold over more subjects than one row of workgroups reaches the last of them', async (device) => {
  type Q = { v: number };
  // One past the 65,535 workgroups of 64 a dispatch takes in one dimension by default.
  const many: C[] = Array.from({ length: 65_536 * 64 }, (_, i) => ({ i }));
  const ramp = keys<C, Q>(1000, [
    { at: 0, delta: { v: 0 } },
    { at: 1, delta: { v: 10 } },
  ]);
  const g = mix<C, Q>(kit<Q>({ v: sum() }), { engine: gpu({ device }) });
  g.sync(0);
  g.cue({ patch: ramp, loop: true });
  const side = gpuOf(g);
  side.subjects(many, () => ({}));
  g.sync(1);
  side.channel('v');
  await side.ready;
  g.sync(250);
  const ch = side.channel('v');
  if (ch === null) throw new Error('v is not on the GPU');
  const got = await readBack(device, ch.buffer, ch.offset, many.length * 4);
  for (const i of [0, 65_535 * 64 - 1, 65_535 * 64, many.length - 1])
    close(got[i] as number, 2.5, `subject ${i}`);
});
