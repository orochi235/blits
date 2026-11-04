import { gpu, gpuOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { glide, kit, mix, mixer, spring, sum, tween, vec } from '../../src/index.js';
import { close, closeNear, readBack, test } from './harness.js';

interface C {
  id: number;
}
type P = { x: number; p: number[] };
type Name = keyof P;
const cellsOf = (n: number): C[] => Array.from({ length: n }, (_, id) => ({ id }));
const CELLS = cellsOf(65);

/** Anything a motion patch is: what the scripts below call on it. */
type Moving = {
  to?(subject: C, goal: number | number[], at?: number): void;
  push?(subject: C, v: number | number[], at?: number): void;
  read(subject: C, at?: number): { value: number | number[] } | undefined;
};
type Make = () => object;
/** Something done to a patch at a time, the same on the GPU's mix and the CPU's. */
type Act = { at: number; act: (patch: Moving, cells: readonly C[]) => void };

const make = (patch: object, engine: typeof mixer, cells: readonly C[]) => {
  const k = kit<P>({ x: sum(), p: vec(2, sum()) });
  const m = mix<C, P>(k, { engine, name: 'motion' });
  m.sync(0);
  m.cue({ patch: patch as never, subjects: cells as C[] });
  return m;
};

/** Calls `f` on each of `cells` whose index `keep` takes. */
const each = (cells: readonly C[], keep: (i: number) => boolean, f: (s: C) => void) => {
  cells.forEach((s, i) => {
    if (keep(i)) f(s);
  });
};

const axesOf = (v: number | number[]) => (typeof v === 'number' ? [v] : v);

/**
 * Plays the same motion on the GPU and the CPU, doing `acts` on both at their times, and compares
 * every subject at `times`. `near` compares a branchy patch one f32 step either way in time.
 */
async function agree(
  device: GpuDevice,
  name: Name,
  build: Make,
  times: number[],
  opts: { acts?: Act[]; cells?: readonly C[]; near?: boolean; reorder?: number } = {},
) {
  let cells = opts.cells ?? CELLS;
  const gp = build() as Moving;
  const cp = build() as Moving;
  const g = make(gp, gpu({ device }), cells);
  const c = make(cp, mixer, cells);
  const side = gpuOf(g);
  side.subjects(cells, () => ({}));
  side.channel(name);
  await side.ready;
  const acts = opts.acts ?? [];
  const all = [...new Set([...times, ...acts.map((a) => a.at)])].sort((a, b) => a - b);
  for (const t of all) {
    g.sync(t);
    c.sync(t);
    if (opts.reorder === t) {
      cells = [...cells].reverse();
      side.subjects(cells, () => ({}));
    }
    for (const a of acts) if (a.at === t) for (const p of [gp, cp]) a.act(p, cells);
    if (!times.includes(t)) continue;
    const ch = side.channel(name);
    if (ch === null) throw new Error(`${name} is not on the GPU at ${t}`);
    const got = await readBack(device, ch.buffer, ch.offset, cells.length * ch.axes * 4);
    cells.forEach((s, i) => {
      const want = axesOf(c.probe(s)[name] as number | number[]);
      want.forEach((w, a) => {
        const what = `${name}[${a}] t ${t} subject ${s.id}`;
        const at = got[i * ch.axes + a] as number;
        if (opts.near)
          closeNear(
            at,
            (tt) => axesOf((cp.read(s, tt) as { value: number | number[] }).value)[a] as number,
            t,
            what,
          );
        else close(at, w, what);
      });
    });
  }
}

const TIMES = [0, 90, 250, 600, 1400];
const SPRINGS = [
  ['under-damped', 180, 12],
  ['critically damped', 100, 20],
  ['over-damped', 100, 50],
] as const;

for (const [kind, stiffness, damping] of SPRINGS)
  test(`motion: a spring ${kind}`, (d) =>
    agree(
      d,
      'x',
      () =>
        spring<C, P>('x', {
          from: (c) => (c.id % 9) * 10,
          to: (c) => 50 + (c.id % 4) * 5,
          velocity: (c) => (c.id % 3) * 100 - 100,
          stiffness,
          damping,
        }),
      TIMES,
    ));

test('motion: a spring on vec(2), retargeted and pushed', (d) =>
  agree(
    d,
    'p',
    () =>
      spring<C, P, number[]>('p', {
        from: (c) => [c.id, -c.id],
        to: [40, 20],
        stiffness: 180,
        damping: 12,
      }),
    TIMES,
    {
      acts: [
        {
          at: 90,
          act: (p, cs) =>
            each(
              cs,
              (i) => i % 2 === 0,
              (s) => p.to?.(s, [10, s.id]),
            ),
        },
        {
          at: 250,
          act: (p, cs) =>
            each(
              cs,
              (i) => i % 3 === 0,
              (s) => p.push?.(s, [200, -50]),
            ),
        },
      ],
    },
  ));

test('motion: a tween easing in and out, retargeted', (d) =>
  agree(
    d,
    'x',
    () =>
      tween<C, P>('x', {
        from: (c) => c.id,
        to: (c) => 100 - c.id,
        ms: (c) => 300 + c.id * 10,
        ease: 'ease-in-out',
      }),
    TIMES,
    {
      acts: [
        {
          at: 250,
          act: (p, cs) =>
            each(
              cs,
              (i) => i % 2 === 1,
              (s) => p.to?.(s, 7),
            ),
        },
      ],
    },
  ));

test('motion: a tween in steps', (d) =>
  agree(
    d,
    'x',
    () => tween<C, P>('x', { from: (c) => c.id, to: 100, ms: 400, ease: { steps: 4 } }),
    [0, 100, 250, 300, 600],
    { near: true },
  ));

test('motion: a glide without bounds', (d) =>
  agree(
    d,
    'x',
    () =>
      glide<C, P>('x', {
        from: (c) => c.id,
        velocity: (c) => (c.id % 7) * 60 - 180,
      }),
    TIMES,
    {
      acts: [
        {
          at: 250,
          act: (p, cs) =>
            each(
              cs,
              (i) => i % 4 === 0,
              (s) => p.push?.(s, 300),
            ),
        },
      ],
    },
  ));

test('motion: a glide with bounds, released inside, crossing and past an edge', (d) =>
  agree(
    d,
    'x',
    () =>
      glide<C, P>('x', {
        from: (c) => [50, 50, 120, -30][c.id % 4] as number,
        velocity: (c) => [10 + c.id * 0.37, 400, -20, 10][c.id % 4] as number,
        bounds: [0, 100],
      }),
    TIMES,
    { near: true },
  ));

test('motion: a glide let go past an edge with its rest a hair past it too', (d) =>
  agree(
    d,
    'x',
    () =>
      glide<C, P>('x', {
        from: 120,
        velocity: (c) => ([-20 + 1e-4, -20 + 1e-6, -20, -20 - 1e-6][c.id % 4] as number) / 0.325,
        bounds: [0, 100],
      }),
    [0, 40, 90, 250, 600],
  ));

test('motion: 1,000 subjects each retargeted at a time of its own', (d) =>
  agree(
    d,
    'x',
    () => spring<C, P>('x', { to: (c) => c.id % 10, stiffness: 180, damping: 12 }),
    [0, 300, 900, 1500, 2600],
    {
      cells: cellsOf(1000),
      acts: [
        {
          at: 0,
          act: (p, cs) =>
            each(
              cs,
              () => true,
              (s) => p.to?.(s, 60 + (s.id % 5), 10 + s.id * 2.3),
            ),
        },
      ],
    },
  ));

test('motion: a retarget in the frame being read, with no probe on the CPU', async (d) => {
  const build = () => spring<C, P>('x', { to: 30, from: 0, stiffness: 180, damping: 12 });
  const gp = build();
  const cp = build();
  const g = make(gp, gpu({ device: d }), CELLS);
  const c = make(cp, mixer, CELLS);
  const side = gpuOf(g);
  side.subjects(CELLS, () => ({}));
  side.channel('x');
  await side.ready;
  const check = async (when: string) => {
    const ch = side.channel('x');
    if (ch === null) throw new Error('x is not on the GPU');
    const got = await readBack(d, ch.buffer, ch.offset, CELLS.length * 4);
    CELLS.forEach((s, i) => {
      close(got[i] as number, c.probe(s).x, `${when} subject ${s.id}`);
    });
  };
  for (const m of [g, c]) m.sync(300);
  await check('before the retarget');
  for (const [p, s] of CELLS.flatMap((s) => [[gp, s] as const, [cp, s] as const]))
    if (s.id % 2 === 0) p.to(s, 80);
  await check('in the frame of the retarget');
  for (const m of [g, c]) m.sync(500);
  await check('a frame later');
});

test('motion: a list registered again in another order', (d) =>
  agree(d, 'x', () => spring<C, P>('x', { from: (c) => c.id, to: 0 }), [0, 90, 250, 600, 1400], {
    reorder: 250,
    acts: [
      {
        at: 600,
        act: (p, cs) =>
          each(
            cs,
            (i) => i < 5,
            (s) => p.to?.(s, 99),
          ),
      },
    ],
  }));
