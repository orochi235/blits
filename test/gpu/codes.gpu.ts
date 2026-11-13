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
