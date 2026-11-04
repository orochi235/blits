import { gpu, gpuOf } from '../../src/gpu/engine.js';
import { shaderPatch } from '../../src/gpu/shader-patch.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { type Kit, keys, kit, mix, mixer, spring, sum, wave } from '../../src/index.js';
import { close, readBack, test } from './harness.js';

interface C {
  id: number;
}
type P = { v: number };
const N = 65;
const CELLS: C[] = Array.from({ length: N }, (_, id) => ({ id }));
const TIMES = [1, 250, 999, 1000, 1700, 4100];

/** What the scripts below call on a motion patch. */
type Moving = { to?(subject: C, goal: number, at?: number): void };
/** Something done to every cue's patch at a time, the same on the GPU's mix and the CPU's. */
type Act = { at: number; act: (patch: Moving, cells: readonly C[]) => void };

/** A runner kind: a fresh patch for cue `k` (a motion patch holds state), and what is done to it. */
interface Kind {
  name: string;
  patch: (k: number, kit: Kit<P>) => object;
  loop: boolean;
  acts?: Act[];
}

/** A voice: which subjects it reaches and how, and how it plays. */
interface Cue {
  reach: (i: number) => boolean;
  by: 'subjects' | 'target';
  role?: string;
  weight?: number;
  fade?: number;
  /** When its handle fades it out, over 1000 ms. */
  outAt?: number;
}

const shader = shaderPatch<C, P, { k: number }>(1000, {
  fields: { id: 'f32' },
  params: { k: 'f32' },
  wgsl: 'out.v = params.k * sin(6.2831853 * phase + subject.id * 0.1) + subject.id * 0.01;',
  at: (phase, c, _s, p) => ({ v: p.k * Math.sin(6.2831853 * phase + c.id * 0.1) + c.id * 0.01 }),
  writes: ['v'],
});

const KINDS: Kind[] = [
  { name: 'shaderPatch', loop: true, patch: (k) => shader.with({ k: 1 + k }) },
  {
    name: 'wave',
    loop: true,
    patch: (k, kt) => wave<C, P>(1000, { depth: { v: 1 + k }, phase: 0.1 * k, kit: kt }),
  },
  {
    name: 'keys with an eased stop',
    loop: true,
    patch: (k, kt) =>
      keys<C, P>(
        1000,
        [
          { at: 0, delta: { v: 0 } },
          { at: 0.6, delta: { v: 2 + k }, ease: 'ease-in' },
          { at: 1, delta: { v: -1 } },
        ],
        { kit: kt },
      ),
  },
  {
    name: 'spring retargeted mid-run',
    loop: false,
    patch: (k) =>
      spring<C, P>('v', { from: (c) => c.id % 7, to: 10 + k, stiffness: 180, damping: 12 }),
    acts: [
      {
        at: 250,
        act: (p, cells) =>
          cells.forEach((s, i) => {
            if (i % 2 === 0) p.to?.(s, 30 - s.id * 0.1);
          }),
      },
    ],
  },
];

/** The kind's voices cued by `cues` on a mix made by `engine`. */
function make(kind: Kind, cues: Cue[], engine: typeof mixer) {
  const kt = kit<P>({ v: sum() });
  const m = mix<C, P>(kt, { engine, name: 'reach' });
  m.sync(0);
  const patches: Moving[] = [];
  const handles = cues.map((c, k) => {
    const patch = kind.patch(k, kt);
    patches.push(patch as Moving);
    const reached = CELLS.filter((_, i) => c.reach(i));
    return m.cue({
      patch: patch as never,
      ...(c.by === 'subjects' ? { subjects: reached } : { target: (s: C) => reached.includes(s) }),
      weight: c.weight ?? 1,
      loop: kind.loop,
      ...(c.role === undefined ? {} : { role: c.role }),
      ...(c.fade === undefined ? {} : { fade: { in: c.fade, out: 1000 } }),
    });
  });
  return { m, patches, handles };
}

/** Plays the same voices on the GPU and the CPU and compares every subject at `TIMES`. */
async function agree(device: GpuDevice, kind: Kind, cues: Cue[]) {
  const g = make(kind, cues, gpu({ device }));
  const c = make(kind, cues, mixer);
  const side = gpuOf(g.m);
  side.subjects(CELLS, (s) => ({ id: s.id }));
  side.channel('v');
  await side.ready;
  const acts = kind.acts ?? [];
  const outs = cues.flatMap((q) => (q.outAt === undefined ? [] : [q.outAt]));
  const all = [...new Set([...TIMES, ...acts.map((a) => a.at), ...outs])].sort((a, b) => a - b);
  for (const t of all) {
    g.m.sync(t);
    c.m.sync(t);
    for (const a of acts)
      if (a.at === t) for (const x of [g, c]) for (const p of x.patches) a.act(p, CELLS);
    cues.forEach((q, k) => {
      if (q.outAt === t) for (const x of [g, c]) x.handles[k]?.fade();
    });
    if (!TIMES.includes(t)) continue;
    const ch = side.channel('v');
    if (ch === null) throw new Error(`v is not on the GPU at ${t}`);
    const got = await readBack(device, ch.buffer, ch.offset, N * 4);
    CELLS.forEach((s, i) => {
      close(got[i] as number, c.m.probe(s).v, `t ${t} subject ${i}`);
    });
  }
}

const CASES: [string, Cue[]][] = [
  [
    'a voice naming every third registered subject',
    [
      { reach: (i) => i % 3 === 0, by: 'subjects' },
      { reach: (i) => i % 3 === 1, by: 'subjects', weight: 0.6 },
    ],
  ],
  [
    'a target voice reaching the even subjects',
    [
      { reach: (i) => i % 2 === 0, by: 'target' },
      { reach: () => true, by: 'subjects', weight: 0.3 },
    ],
  ],
  [
    'two voices in one role, each reaching half, overlapping on a quarter',
    [
      { reach: (i) => i % 4 < 2, by: 'subjects', role: 'r', weight: 0.6 },
      { reach: (i) => i % 4 === 1 || i % 4 === 2, by: 'target', role: 'r', weight: 0.8 },
      { reach: () => true, by: 'subjects', weight: 0.25 },
    ],
  ],
  [
    'a partial voice fading in and out',
    [
      { reach: (i) => i % 2 === 1, by: 'subjects', fade: 400, outAt: 999 },
      { reach: () => true, by: 'subjects', weight: 0.5 },
    ],
  ],
];

for (const kind of KINDS)
  for (const [name, cues] of CASES)
    test(`reach (${kind.name}): ${name}`, (d) => agree(d, kind, cues));
