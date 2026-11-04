import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { type ShaderPatch, shaderPatch } from '../../src/gpu/shader-patch.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { kit, mix, mixer, sum } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  x: number;
  y: number;
}
type P = { v: number };
type None = Record<never, never>;
const W = 40;
const H = 7;
const bitmap = Array.from({ length: W * H }, (_, i) => ((i * 7) % 11) / 10);
const rows = Array.from({ length: H }, (_, y) => (y === 3 ? -1 : y));
const cells: C[] = Array.from({ length: W * H }, (_, i) => ({ x: i % W, y: Math.floor(i / W) }));

const move = shaderPatch<C, P, None, 'bitmap' | 'rows'>(1000, {
  fields: { x: 'f32', y: 'f32' },
  tables: { bitmap: { width: W, height: H }, rows: { width: 1, height: H } },
  wgsl: 'out.v = table_bitmap(i32(subject.x) - i32(phase * 40.0), i32(table_rows(0, i32(subject.y)))) + table_rows(0, i32(subject.y)) * 0.01;',
  at: (phase, c, _s, p) => ({
    v: p.bitmap(c.x - Math.trunc(phase * 40), Math.trunc(p.rows(0, c.y))) + p.rows(0, c.y) * 0.01,
  }),
  writes: ['v'],
});
const reach = shaderPatch<C, P, None, 'bitmap'>(1000, {
  fields: { x: 'f32', y: 'f32' },
  tables: { bitmap: { width: W, height: H } },
  wgsl: 'out.v = table_bitmap(i32(subject.x) - 3, i32(subject.y) - 1);',
  at: (_phase, c, _s, p) => ({ v: p.bitmap(c.x - 3, c.y - 1) }),
  writes: ['v'],
});

type Voice = ShaderPatch<C, P, None, 'bitmap'> | ShaderPatch<C, P, None, 'bitmap' | 'rows'>;
const make = (engine: typeof mixer, patches: Voice[]) => {
  const m = mix<C, P>(kit<P>({ v: sum() }), { engine });
  m.sync(0);
  for (const patch of patches) m.cue({ patch: patch as never, subjects: cells, loop: true });
  return m;
};
type Made = ReturnType<typeof make>;

/** Reads `v` from the GPU and compares each subject with the CPU mix `c`. */
async function compare(device: GpuDevice, g: Made, c: Made, what: string) {
  const ch = gpuOf(g).channel('v');
  if (ch === null) throw new Error('v is not on the GPU');
  const got = await readBack(device, ch.buffer, ch.offset, cells.length * 4);
  cells.forEach((s, i) => {
    close(got[i] as number, c.probe(s).v, `${what} subject ${i}`);
  });
}

async function agree(device: GpuDevice, patches: Voice[], times: number[]) {
  const g = make(gpu({ device }), patches);
  const c = make(mixer, patches);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x, y: s.y }));
  g.sync(1);
  side.channel('v');
  await side.ready;
  for (const t of times) {
    g.sync(t);
    c.sync(t);
    await compare(device, g, c, `t=${t}`);
  }
}

test('tables: a bitmap and a row map read at a shifted position', async (d) => {
  await agree(d, [move.with({ bitmap, rows })], [100, 250, 500, 900]);
});

test('tables: out-of-range reads are 0', async (d) => {
  await agree(d, [reach.with({ bitmap })], [10]);
});

test('tables: two voices with different tables in one frame', async (d) => {
  await agree(d, [reach.with({ bitmap }), reach.with({ bitmap: bitmap.map((v) => 1 - v) })], [10]);
});

test('tables: new contents reach the GPU without a recompile', async (device) => {
  let compiles = 0;
  const raw = device.createComputePipelineAsync.bind(device);
  device.createComputePipelineAsync = (desc) => {
    compiles++;
    return raw(desc);
  };
  try {
    const g = make(gpu({ device }), []);
    const c = make(mixer, []);
    const first = [g, c].map((m) =>
      m.cue({ patch: reach.with({ bitmap }) as never, subjects: cells, loop: true }),
    );
    const side = gpuOf(g);
    side.subjects(cells, (s) => ({ x: s.x, y: s.y }));
    g.sync(10);
    c.sync(10);
    side.channel('v');
    await side.ready;
    await compare(device, g, c, 'first contents');
    const before = compiles;
    if (before === 0) throw new Error('the kernel never compiled');
    const next = bitmap.map((v) => v + 2);
    for (const [k, m] of [g, c].entries()) {
      first[k]?.fade();
      m.cue({ patch: reach.with({ bitmap: next }) as never, subjects: cells, loop: true });
    }
    g.sync(2000);
    c.sync(2000);
    await compare(device, g, c, 'new contents');
    await side.ready;
    if (compiles !== before) throw new Error(`recompiled ${compiles - before} times`);
  } finally {
    device.createComputePipelineAsync = raw;
  }
});
