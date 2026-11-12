import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { shaderPatch } from '../../src/gpu/shader-patch.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { color, colorDodge, colorMode, keys, kit, type Mix, mix, mixer } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { c: number[]; g: number[] };
const N = 129;
const cells: C[] = Array.from({ length: N }, (_, i) => ({ x: i / (N - 1) }));
type Disc = { L: number; a: number; b: number; r: number };

/** A disc moving across the row, as a new shader each call: each is a runner of its own. */
const disc = (speed: number) =>
  shaderPatch<C, P, Disc>(1000, {
    fields: { x: 'f32' },
    params: { L: 'f32', a: 'f32', b: 'f32', r: 'f32' },
    wgsl: `let d = abs(subject.x - fract(phase * ${speed}.0)); let cov = clamp(0.5 + (params.r - d) * 20.0, 0.0, 1.0); out.c = array<f32, 4>(params.L * cov, params.a * cov, params.b * cov, cov);`,
    at: (phase, s, _st, p) => {
      const d = Math.abs(s.x - ((phase * speed) % 1));
      const cov = Math.min(1, Math.max(0, 0.5 + (p.r - d) * 20));
      return { c: [p.L * cov, p.a * cov, p.b * cov, cov] };
    },
    writes: ['c'],
  });

const RED = { L: 0.63, a: 0.22, b: 0.13, r: 0.2 };
const BLUE = { L: 0.45, a: -0.03, b: -0.19, r: 0.3 };
const GREEN = { L: 0.7, a: -0.15, b: 0.12, r: 0.25 };

/** A gpu mix and a CPU one alike: an old disc on `c` and a wash on `g`. */
function pair(device: GpuDevice) {
  const old = disc(1);
  const make = (engine: typeof mixer) => {
    const k = kit<P>({ c: color(colorDodge({ layers: 6 })), g: color(colorMode()) });
    const m = mix<C, P>(k, { engine, name: 'stand-in' });
    m.sync(0);
    m.cue({ patch: old.with(RED), subjects: cells, loop: true, role: 'a' });
    m.cue({
      patch: keys<C, P>(0, [{ at: 0, delta: { g: [0.5, 0.1, 0, 0.7] } }], { kit: k }),
      subjects: cells,
    });
    return m;
  };
  return { g: make(gpu({ device })), c: make(mixer) };
}

async function agree(device: GpuDevice, g: Mix<C, P>, c: Mix<C, P>, name: 'c' | 'g', what: string) {
  const ch = gpuOf(g).channel(name);
  if (ch === null) throw new Error(`${what}: ${name} is not on the GPU`);
  const axes = ch.axes;
  const got = await readBack(device, ch.buffer, ch.offset, N * axes * 4);
  cells.forEach((s, i) => {
    const want = c.probe(s)[name];
    for (let a = 0; a < axes; a++)
      close(
        got[i * axes + a] as number,
        want[a] ?? 0,
        `${what} ${name} subject ${i} axis ${a}`,
        1e-3,
      );
  });
}

/** Folds both up to the old voices' kernel, then cues `join` on each. */
async function joined(device: GpuDevice, join: (m: Mix<C, P>) => void) {
  const { g, c } = pair(device);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x }));
  side.channel('c');
  await side.ready;
  g.sync(100);
  c.sync(100);
  join(g);
  join(c);
  g.sync(200);
  c.sync(200);
  return { g, c, side };
}

test('stand-in: a new shader joining mid-run folds from its at while its kernel compiles', async (d) => {
  const fresh = disc(2);
  const { g, c, side } = await joined(d, (m) => {
    m.cue({ patch: fresh.with(BLUE), subjects: cells, loop: true, weight: 0.6 });
    m.cue({ patch: fresh.with(GREEN), subjects: cells, loop: true, role: 'a', weight: 0.5 });
  });
  await agree(d, g, c, 'c', 'compiling');
  await agree(d, g, c, 'g', 'compiling');
  await side.ready;
  g.sync(450);
  c.sync(450);
  await agree(d, g, c, 'c', 'compiled');
});

test('stand-in: a new staggered shader keeps its channel on the CPU, the rest folds', async (d) => {
  const fresh = disc(3);
  const { g, c, side } = await joined(d, (m) => {
    m.cue({ patch: fresh.with(BLUE), subjects: cells, loop: true, stagger: (s) => s.x * 100 });
  });
  if (side.channel('c') !== null) throw new Error('c was on the GPU before its kernel compiled');
  await agree(d, g, c, 'g', 'compiling');
  await side.ready;
  g.sync(450);
  c.sync(450);
  await agree(d, g, c, 'c', 'compiled');
});
