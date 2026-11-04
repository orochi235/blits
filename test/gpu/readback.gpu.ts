import { gpu, gpuOf } from '../../src/gpu/engine.js';
import type { GpuRead } from '../../src/gpu/readback.js';
import type { GpuSide } from '../../src/gpu/side.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { keys, kit, mix, mixer, patch, spring, sum, vec } from '../../src/index.js';
import { close, test } from './harness.js';

interface C {
  i: number;
}
type P = { s: number; p: number[]; q: number[]; r: number[] };
type Name = keyof P;
const N = 64;
const CELLS: C[] = Array.from({ length: N }, (_, i) => ({ i }));
const FRAME = 16;
const NAMES: Name[] = ['s', 'p', 'q'];

/** The mix: `r` is in its kit only where `grows`, written by a voice that keeps it on the CPU. */
const make = (engine: typeof mixer, grows = false) => {
  const rules = { s: sum(), p: vec(3, sum()), q: vec(2, sum()) };
  const k = kit<P>((grows ? { ...rules, r: vec(4, sum()) } : rules) as never);
  const m = mix<C, P>(k, { engine, name: 'readback' });
  m.sync(0);
  m.cue({
    patch: keys<C, P>(
      500,
      [
        { at: 0, delta: { s: 0 } },
        { at: 0.5, delta: { s: 3 }, ease: 'ease-in-out' },
        { at: 1, delta: { s: -1 } },
      ],
      { kit: k },
    ),
    subjects: CELLS,
    loop: true,
  });
  m.cue({
    patch: keys<C, P>(
      1000,
      [
        { at: 0, delta: { p: [0, 0, 0] } },
        { at: 0.6, delta: { p: [1, 2, 3] }, ease: 'ease-in' },
        { at: 1, delta: { p: [-1, 0, 4] } },
      ],
      { kit: k },
    ),
    subjects: CELLS,
    stagger: (c) => c.i * 9,
    fade: { in: 200 },
  });
  const spr = spring<C, P, number[]>('q', { from: (c) => [c.i * 0.1, 0], to: [0, 1] });
  m.cue({ patch: spr, subjects: CELLS });
  const cpu = grows
    ? m.cue({
        patch: patch<C, P>(0, () => ({ r: [1, 2, 3, 4] }), { writes: ['r'] }),
        subjects: CELLS,
        loop: true,
      })
    : null;
  return { m, k, spr, cpu };
};
type Made = ReturnType<typeof make>;

/** Syncs frame `f` and retargets subject `f % N`'s spring. */
function step(x: Made, f: number): void {
  x.m.sync(f * FRAME);
  x.spr.to(CELLS[f % N] as C, [f, -0.5 * f]);
}

/** Each subject's numbers for each channel, as the CPU twin probes them. */
type Snap = Map<C, Record<string, number[]>>;
function snap(x: Made): Snap {
  const out: Snap = new Map();
  for (const s of CELLS) {
    const p = x.m.probe(s) as unknown as Record<string, number | number[]>;
    const rec: Record<string, number[]> = {};
    for (const [n, v] of Object.entries(p)) rec[n] = typeof v === 'number' ? [v] : [...v];
    out.set(s, rec);
  }
  return out;
}

/** Throws where `r` is null, is not of the frame `frame`, or differs from the twin's `want`. */
function agrees(r: GpuRead<C> | null, name: string, frame: number, want: Snap): void {
  if (r === null) throw new Error(`frame ${frame} ${name}: read null`);
  if (r.timestamp !== frame * FRAME)
    throw new Error(`${name}: timestamp ${r.timestamp}, wanted frame ${frame}'s ${frame * FRAME}`);
  if (r.values.length !== r.subjects.length * r.axes)
    throw new Error(`${name}: ${r.values.length} values for ${r.subjects.length} × ${r.axes}`);
  r.subjects.forEach((s, i) => {
    const w = want.get(s)?.[name] as number[];
    if (w.length !== r.axes) throw new Error(`${name}: ${r.axes} axes, CPU ${w.length}`);
    for (let a = 0; a < r.axes; a++)
      close(
        r.values[i * r.axes + a] as number,
        w[a] as number,
        `frame ${frame} ${name} ${s.i}.${a}`,
      );
  });
}

/** Registers the subjects and waits for the kernel, so the first frame folds on the GPU. */
async function warm(x: Made, names: readonly Name[] = NAMES): Promise<GpuSide<C>> {
  const side = gpuOf(x.m);
  side.subjects(CELLS, () => ({}));
  for (const n of names) side.channel(n);
  await side.ready;
  return side;
}

function onGpu(side: GpuSide<C>, names: readonly string[], f: number): void {
  for (const n of names) if (side.channel(n) === null) throw new Error(`${n} off the GPU at ${f}`);
}

const reads = (side: GpuSide<C>, names: readonly string[]) =>
  Promise.all(names.map((n) => side.read(n)));

test("readback: each read gives the previous frame's fold of every subject", async (d) => {
  const g = make(gpu({ device: d }));
  const c = make(mixer);
  const side = await warm(g);
  const kept: Snap[] = [];
  for (let f = 1; f <= 40; f++) {
    step(g, f);
    step(c, f);
    onGpu(side, NAMES, f);
    const got = await reads(side, NAMES);
    kept[f] = snap(c);
    // Frame 1 is each channel's first read, which waits on the current fold.
    const from = f === 1 ? 1 : f - 1;
    NAMES.forEach((n, k) => {
      agrees(got[k] as GpuRead<C> | null, n, from, kept[from] as Snap);
    });
  }
});

test('readback: an await-read-then-sync loop', async (d) => {
  const g = make(gpu({ device: d }));
  const c = make(mixer);
  const side = await warm(g, ['s']);
  const kept: Snap[] = [];
  step(g, 1);
  step(c, 1);
  kept[1] = snap(c);
  const start = performance.now();
  for (let j = 1; j <= 60; j++) {
    const r = await side.read('s');
    onGpu(side, ['s'], j);
    // The read after frame j's sync gives frame j - 1's fold; frame 1's is a first read.
    const from = j === 1 ? 1 : j - 1;
    agrees(r, 's', from, kept[from] as Snap);
    step(g, j + 1);
    step(c, j + 1);
    kept[j + 1] = snap(c);
  }
  // A stall detector with about 10× headroom, not a benchmark: don't tighten it.
  const took = performance.now() - start;
  if (took > 60 * 50) throw new Error(`60 frames took ${took.toFixed(0)} ms`);
});

test('readback: a kernel change that grows out', async (d) => {
  const g = make(gpu({ device: d }), true);
  const c = make(mixer, true);
  const side = await warm(g);
  const kept: Snap[] = [];
  const both = ['s', 'p'];
  step(g, 1);
  step(c, 1);
  onGpu(side, both, 1);
  if (side.channel('r') !== null) throw new Error('r on the GPU before its CPU voice went idle');
  const before = side.channel('s')?.buffer;
  kept[1] = snap(c);
  (await reads(side, both)).forEach((r, k) => {
    agrees(r, both[k] as string, 1, kept[1] as Snap);
  });

  const scoped = d as unknown as {
    pushErrorScope(f: string): void;
    popErrorScope(): Promise<{ message: string } | null>;
  };
  scoped.pushErrorScope('validation');
  for (const x of [g, c]) {
    (x.cpu as { weight: number }).weight = 0;
    x.m.cue({
      patch: keys<C, P>(
        700,
        [
          { at: 0, delta: { r: [0, 1, 0, 1] } },
          { at: 1, delta: { r: [4, -2, 1, 3] } },
        ],
        { kit: x.k },
      ),
      subjects: CELLS,
      loop: true,
    });
  }
  step(g, 2);
  step(c, 2);
  kept[2] = snap(c);
  // The turn copies frame 1's fold; the kernel writing `r` is still compiling.
  for (const r of await reads(side, both))
    if (r !== null) throw new Error('read during the compile was not null');
  await side.ready;
  // This refold regrows `out`, after the copy above was submitted.
  const second = reads(side, both);
  onGpu(side, [...both, 'r'], 2);
  if (side.channel('s')?.buffer === before) throw new Error('out did not regrow');
  (await second).forEach((r, k) => {
    agrees(r, both[k] as string, 1, kept[1] as Snap);
  });

  step(g, 3);
  step(c, 3);
  kept[3] = snap(c);
  onGpu(side, [...both, 'r'], 3);
  (await reads(side, both)).forEach((r, k) => {
    agrees(r, both[k] as string, 2, kept[2] as Snap);
  });
  agrees(await side.read('r'), 'r', 3, kept[3] as Snap);
  const error = await scoped.popErrorScope();
  if (error !== null) throw new Error(`validation: ${error.message}`);
});

test('readback: subjects() in another order', async (d) => {
  const g = make(gpu({ device: d }));
  const c = make(mixer);
  const side = await warm(g);
  const kept: Snap[] = [];
  const reversed = CELLS.slice().reverse();
  for (let f = 1; f <= 8; f++) {
    step(g, f);
    step(c, f);
    onGpu(side, NAMES, f);
    const got = await reads(side, NAMES);
    kept[f] = snap(c);
    // After subjects(), frame 6's read is a first read again.
    const from = f === 1 || f === 6 ? f : f - 1;
    NAMES.forEach((n, k) => {
      const r = got[k] as GpuRead<C> | null;
      const list = f >= 6 ? reversed : CELLS;
      if (r?.subjects.length !== N || r.subjects.some((s, i) => s !== list[i]))
        throw new Error(`frame ${f} ${n}: subjects not in the registered order`);
      agrees(r, n, from, kept[from] as Snap);
    });
    if (f === 5) side.subjects(reversed, () => ({}));
  }
});

/** A device of the test's own, so destroying it leaves the shared one. */
async function ownDevice(): Promise<GpuDevice> {
  type Adapter = { requestDevice(): Promise<unknown> };
  const api = (navigator as unknown as { gpu: { requestAdapter(): Promise<Adapter | null> } }).gpu;
  const adapter = await api.requestAdapter();
  if (adapter === null) throw new Error('no adapter');
  return (await adapter.requestDevice()) as GpuDevice;
}

/** Starts a read of `s` in frame 1 and checks it is waiting on a map. */
async function waiting(side: GpuSide<C>, x: Made): Promise<{ r: Promise<GpuRead<C> | null> }> {
  step(x, 1);
  onGpu(side, ['s'], 1);
  let settled = false;
  const r = side.read('s');
  void r.then(() => {
    settled = true;
  });
  await Promise.resolve();
  if (settled) throw new Error('the read settled before its map could');
  // Wrapped: an async function returning the promise itself would wait for it.
  return { r };
}

test('readback: a lost device resolves a waiting read with null', async () => {
  const own = await ownDevice();
  const g = make(gpu({ device: own }));
  const side = await warm(g);
  const { r } = await waiting(side, g);
  (own as unknown as { destroy(): void }).destroy();
  if ((await r) !== null) throw new Error('a read waiting at the loss did not resolve null');
  await own.lost;
  step(g, 2);
  if ((await side.read('s')) !== null) throw new Error('a read after the loss was not null');
});

test('readback: close() while a read waits', async (d) => {
  const g = make(gpu({ device: d }));
  const side = await warm(g);
  const { r } = await waiting(side, g);
  g.m.close();
  if ((await r) !== null) throw new Error('a read waiting at close() did not resolve null');
  if ((await side.read('s')) !== null) throw new Error('a read after close() was not null');
});
