import { gpu, gpuOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import {
  angle,
  type Keyframe,
  type KeysOptions,
  keys,
  kit,
  max,
  mix,
  mixer,
  mul,
  sum,
  vec,
} from '../../src/index.js';
import { close, closeNear, readBack, test } from './harness.js';

interface C {
  x: number;
}
type P = { s: number; m: number; x: number; p: number[]; a: number };
const N = 65;
const cells: C[] = Array.from({ length: N }, (_, i) => ({ x: i / (N - 1) }));
const NAMES = ['s', 'm', 'x', 'p', 'a'] as const;
const AXES: Record<(typeof NAMES)[number], number> = { s: 1, m: 1, x: 1, p: 3, a: 1 };
const TIMES = [0, 130, 499, 500, 501, 870, 2300];

type Cue = {
  stops: Keyframe<P>[];
  opts?: Omit<KeysOptions<P>, 'kit'>;
  weight?: number;
  loop?: boolean;
  role?: string;
};

const make = (cues: Cue[], engine: typeof mixer, subjects: C[]) => {
  const k = kit<P>({ s: sum(), m: mul(), x: max(), p: vec(3, sum()), a: angle() });
  const m = mix<C, P>(k, { engine, name: 'keys' });
  m.sync(0);
  for (const c of cues)
    m.cue({
      patch: keys<C, P>(1000, c.stops, { ...c.opts, kit: k }),
      subjects,
      weight: c.weight ?? 1,
      loop: c.loop ?? true,
      ...(c.role === undefined ? {} : { role: c.role }),
    });
  return m;
};

/** Plays the same keys voices on the GPU and the CPU and compares every subject at `TIMES`. */
async function agree(device: GpuDevice, cues: Cue[], near = false) {
  const g = make(cues, gpu({ device }), cells);
  const c = make(cues, mixer, cells);
  const side = gpuOf(g);
  side.subjects(cells, (s) => ({ x: s.x }));
  for (const name of NAMES) side.channel(name);
  await side.ready;
  // Keys ignore the subject, so one lone CPU mix gives the value at any nearby time.
  const cpuAt = (t: number, name: (typeof NAMES)[number], a: number) => {
    const one = make(cues, mixer, [cells[0] as C]);
    one.sync(t);
    const v = one.probe(cells[0] as C)[name];
    return (Array.isArray(v) ? v[a] : v) as number;
  };
  for (const t of TIMES) {
    g.sync(t);
    c.sync(t);
    for (const name of NAMES) {
      const ch = side.channel(name);
      if (ch === null) throw new Error(`${name} is not on the GPU`);
      const axes = AXES[name];
      const got = await readBack(device, ch.buffer, ch.offset, N * axes * 4);
      cells.forEach((s, i) => {
        const want = c.probe(s)[name];
        for (let a = 0; a < axes; a++) {
          const what = `${name}[${a}] t ${t} subject ${i}`;
          const v = got[i * axes + a] as number;
          if (near) closeNear(v, (tt) => cpuAt(tt, name, a), t, what);
          else close(v, (Array.isArray(want) ? want[a] : want) as number, what);
        }
      });
    }
  }
}

const MIXED: Keyframe<P>[] = [
  { at: 0, delta: { s: 0, m: 1, x: 0 } },
  { at: 0.25, delta: { s: 1, m: 2, x: 0.4 }, ease: 'ease-in' },
  { at: 0.5, delta: { s: 3, m: 0.5, x: 1.5 } },
  { at: 0.8, delta: { s: -1, m: 3, x: 0.2 }, ease: { bezier: [0.3, -0.4, 0.6, 1.5] } },
  { at: 1, delta: { s: 2, m: 1, x: 1 } },
];

test('keys: stops with mixed easings on sum, mul and max', (d) =>
  agree(d, [
    { stops: MIXED, opts: { ease: 'ease-out', easeBy: (c) => (c === 'm' ? 'ease' : undefined) } },
  ]));

test('keys: a vec(3, sum()) track', (d) =>
  agree(d, [
    {
      stops: [
        { at: 0, delta: { p: [0, 0, 0] } },
        { at: 0.5, delta: { p: [1, 2, 3] }, ease: 'ease-in-out' },
        { at: 1, delta: { p: [-1, 0, 4] } },
      ],
    },
  ]));

test('keys: an angle track crossing 0', (d) =>
  agree(d, [
    {
      stops: [
        { at: 0, delta: { a: 340 } },
        { at: 0.5, delta: { a: 20 } },
        { at: 1, delta: { a: -30 } },
      ],
    },
  ]));

test('keys: delayBy on one channel', (d) =>
  agree(d, [{ stops: MIXED, opts: { delayBy: (c) => (c === 's' ? 300 : 0) } }]));

test('keys: a delay as long as the duration, or longer', (d) =>
  agree(d, [
    { stops: MIXED, opts: { delayBy: (c) => (c === 's' ? 1000 : c === 'm' ? 1500 : 0) } },
  ]));

test('keys: steps easing', (d) =>
  agree(
    d,
    [
      {
        stops: [
          { at: 0, delta: { s: 0, x: 0 } },
          { at: 1, delta: { s: 4, x: 2 }, ease: { steps: 4 } },
        ],
      },
      {
        stops: [
          { at: 0.1, delta: { m: 1 } },
          { at: 0.9, delta: { m: 3 }, ease: { steps: 3, jump: 'start' } },
        ],
      },
    ],
    true,
  ));

test('keys: two patches with different stops in one frame', (d) =>
  agree(d, [
    { stops: MIXED },
    {
      stops: [
        { at: 0.2, delta: { s: 5, x: 3, a: 90 } },
        { at: 0.6, delta: { s: -2, x: 0.5, a: 270 }, ease: 'ease-in' },
      ],
      weight: 0.6,
    },
  ]));

test('keys: a role of two keys voices', (d) =>
  agree(d, [
    { stops: MIXED, role: 'r' },
    {
      stops: [
        { at: 0, delta: { s: 4, m: 2, x: 1, a: 350 } },
        { at: 1, delta: { s: 0, m: 0.5, x: 0, a: 10 } },
      ],
      role: 'r',
      weight: 0.5,
    },
  ]));

test('keys: past the end, not looped', (d) => agree(d, [{ stops: MIXED, loop: false }]));
