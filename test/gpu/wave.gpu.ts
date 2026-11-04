import { gpu, gpuOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import {
  type Channel,
  kit,
  mix,
  mixer,
  mul,
  sum,
  type WaveOptions,
  type WaveShape,
  wave,
} from '../../src/index.js';
import { close, closeNear, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { v: number; m: number };
const N = 257;
const cells: C[] = Array.from({ length: N }, (_, i) => ({ x: i / (N - 1) }));
const channels = (): { v: Channel<number>; m: Channel<number> } => ({ v: sum(), m: mul() });

type Cue = { opts: Omit<WaveOptions<P>, 'kit'>; weight?: number; loop?: boolean };

const make = (cues: Cue[], engine: typeof mixer, subjects: C[]) => {
  const k = kit<P>(channels());
  const m = mix<C, P>(k, { engine });
  m.sync(0);
  for (const c of cues)
    m.cue({
      patch: wave<C, P>(1000, { ...c.opts, kit: k }),
      subjects,
      weight: c.weight ?? 1,
      loop: c.loop ?? true,
    });
  return m;
};

/** Plays the same wave voices on the GPU and the CPU and compares every subject at `times`. */
async function agree(device: GpuDevice, cues: Cue[], times: number[], near = false) {
  const g = make(cues, gpu({ device }), cells);
  const c = make(cues, mixer, cells);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x }));
  g.sync(1);
  for (const name of ['v', 'm']) side.channel(name);
  await side.ready;
  // The waves ignore the subject, so one lone CPU mix gives the value at any nearby time.
  const at = new Map<number, { v: number; m: number }>();
  const cpuAt = (t: number, name: 'v' | 'm') => {
    let got = at.get(t);
    if (got === undefined) {
      const one = make(cues, mixer, [cells[0] as C]);
      one.sync(t);
      got = one.probe(cells[0] as C) as { v: number; m: number };
      at.set(t, got);
    }
    return got[name];
  };
  for (const t of times) {
    g.sync(t);
    c.sync(t);
    for (const name of ['v', 'm'] as const) {
      const ch = side.channel(name);
      if (ch === null) throw new Error(`${name} is not on the GPU`);
      const got = await readBack(device, ch.buffer, ch.offset, N * 4);
      cells.forEach((s, i) => {
        const what = `${name} t ${t} subject ${i}`;
        if (near) closeNear(got[i] as number, (tt) => cpuAt(tt, name), t, what);
        else close(got[i] as number, c.probe(s)[name], what);
      });
    }
  }
}

const TIMES = [130, 470, 2600];
const SHAPES: WaveShape[] = ['sine', 'triangle', 'saw', 'square'];
for (const shape of SHAPES)
  test(`${shape}: one voice at full weight`, (d) =>
    agree(
      d,
      [{ opts: { shape, cycles: 2.5, phase: 0.1, depth: { v: 3, m: 0.5 } } }],
      TIMES,
      shape === 'saw' || shape === 'square',
    ));

test('two waves with different cycles, phase and depth in one frame', (d) =>
  agree(
    d,
    [
      { opts: { shape: 'sine', cycles: 1, depth: { v: 2 } } },
      {
        opts: { shape: 'triangle', cycles: 3, phase: 0.3, depth: { v: 0.5, m: 0.25 } },
        weight: 0.6,
      },
      { opts: { shape: 'sine', cycles: 0.5, phase: 0.8, depth: { m: 0.4 } }, weight: 0.3 },
    ],
    TIMES,
  ));

test('a mul channel pulsing around its rest of 1', (d) =>
  agree(d, [{ opts: { shape: 'sine', cycles: 2, depth: { m: 0.5 } } }], TIMES));

test('a looped wave across passes', (d) =>
  agree(
    d,
    [{ opts: { shape: 'sine', cycles: 1.5, phase: 0.2, depth: { v: 1, m: 0.2 } } }],
    [2500, 2600],
  ));

test('a wave past its end, not looped', (d) =>
  agree(d, [{ opts: { shape: 'triangle', depth: { v: 1 } }, loop: false }], [1300]));
