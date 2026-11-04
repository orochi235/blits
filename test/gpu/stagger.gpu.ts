import { gpu, gpuOf, mixerOf } from '../../src/gpu/engine.js';
import { shaderPatch } from '../../src/gpu/shader-patch.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import {
  color,
  type Easing,
  type Kit,
  keys,
  kit,
  mix,
  mixer,
  overlay,
  sum,
  wave,
} from '../../src/index.js';
import type { Voice } from '../../src/voice.js';
import { close, closeNear, readBack, test } from './harness.js';

interface C {
  id: number;
}
const N = 257;
const DURATION = 1000;
const CELLS: C[] = Array.from({ length: N }, (_, id) => ({ id }));
const fieldsOf = (s: C) => ({ id: s.id, x: s.id / (N - 1) });

/** A seeded shuffle of 0..N-1, the order a host such as bree's gives its subjects. */
const RANK: number[] = (() => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const r = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [r[i], r[j]] = [r[j] as number, r[i] as number];
  }
  return r;
})();
const rank = (c: C) => RANK[c.id] as number;
const STAGGER = (c: C) => rank(c) * 7;
/** Delays from -900 to 892. */
const NEGATIVE = (c: C) => rank(c) * 7 - 900;
const TIMES = [1, 250, 999, 1000, 1700, 4100];

/** A runner kind, and the channel its voices write. */
interface Kind {
  name: string;
  kit: () => Kit<never>;
  channel: string;
  tolerance?: number;
  patch: (k: number, kit: Kit<never>) => object;
}

const shader = shaderPatch<C, { v: number }, { k: number }>(DURATION, {
  fields: { id: 'f32' },
  params: { k: 'f32' },
  wgsl: 'out.v = params.k * sin(6.2831853 * phase + subject.id * 0.1) + subject.id * 0.01;',
  at: (phase, c, _s, p) => ({ v: p.k * Math.sin(6.2831853 * phase + c.id * 0.1) + c.id * 0.01 }),
  writes: ['v'],
});

/** A band of one OKLab color sweeping the row, so which layer lies over which shows. */
const disc = shaderPatch<C, { c: number[] }, { L: number; a: number; b: number }>(DURATION, {
  fields: { x: 'f32' },
  params: { L: 'f32', a: 'f32', b: 'f32' },
  wgsl: 'let cov = clamp(0.5 + (0.35 - abs(subject.x - phase)) * 20.0, 0.0, 1.0); out.c = array<f32, 4>(params.L * cov, params.a * cov, params.b * cov, cov);',
  at: (phase, s, _st, p) => {
    const x = s.id / (N - 1);
    const cov = Math.min(1, Math.max(0, 0.5 + (0.35 - Math.abs(x - phase)) * 20));
    return { c: [p.L * cov, p.a * cov, p.b * cov, cov] };
  },
  writes: ['c'],
});
const COLORS = [
  { L: 0.63, a: 0.22, b: 0.13 },
  { L: 0.45, a: -0.03, b: -0.19 },
  { L: 0.8, a: 0.0, b: 0.1 },
  { L: 0.5, a: 0.15, b: -0.1 },
  { L: 0.7, a: -0.12, b: 0.08 },
];

const sums = () => kit<{ v: number }>({ v: sum() }) as unknown as Kit<never>;
const KINDS: Kind[] = [
  {
    name: 'shaderPatch',
    kit: sums,
    channel: 'v',
    patch: (k) => shader.with({ k: 1 + k }),
  },
  {
    name: 'wave',
    kit: sums,
    channel: 'v',
    patch: (k, kt) =>
      wave<C, { v: number }>(DURATION, {
        depth: { v: 1 + k },
        phase: 0.1 * k,
        kit: kt as unknown as Kit<{ v: number }>,
      }),
  },
  {
    name: 'keys',
    kit: sums,
    channel: 'v',
    patch: (k, kt) =>
      keys<C, { v: number }>(
        DURATION,
        [
          { at: 0, delta: { v: 0 } },
          { at: 0.6, delta: { v: 2 + k }, ease: 'ease-in' },
          { at: 1, delta: { v: -1 } },
        ],
        { kit: kt as unknown as Kit<{ v: number }> },
      ),
  },
];
/** A stacked color, where a role's place among the layers is where its leader is. */
const STACKED: Kind = {
  name: 'shaderPatch on a stacked color',
  kit: () => kit<{ c: number[] }>({ c: color(overlay()) }) as unknown as Kit<never>,
  channel: 'c',
  tolerance: 1e-3,
  patch: (k) => disc.with(COLORS[k % COLORS.length] as { L: number; a: number; b: number }),
};

/** A voice: its delays, which subjects it reaches, and how it plays. */
interface Cue {
  stagger?: (c: C) => number;
  reach?: (i: number) => boolean;
  /** Its loop where its subjects are named; one asked as met loops for good. */
  loop?: number | boolean;
  rate?: number;
  role?: string;
  weight?: number;
  fade?: { in: number; out?: number; ease?: Easing };
  freeze?: 'after';
}

type Handle = {
  rate: number;
  ramp(r: number, over: number): void;
  seek(elapsed: number): unknown;
  fade(): void;
  rise(): void;
};

interface Script {
  cues: Cue[];
  times: number[];
  /** Done to both mixes' handles right after the sync at `at`, before that time is compared. */
  acts?: { at: number; act: (h: Handle[]) => void }[];
  /** From this time on the voices stay on the CPU, so the GPU folds no channel. */
  cpuFrom?: number;
  /** After the reading at this time, the subjects are registered again in another order. */
  reorder?: number;
}

/** The kind's voices cued by `cues` on a mix made by `engine`, named or asked as met. */
function make(kind: Kind, cues: Cue[], named: boolean, engine: typeof mixer) {
  const kt = kind.kit();
  const m = mix<C, never>(kt, { engine, name: 'stagger' });
  m.sync(0);
  const handles = cues.map((c, k) => {
    const reached = c.reach === undefined ? CELLS : CELLS.filter((_, i) => c.reach?.(i));
    const whom = named
      ? { subjects: reached }
      : c.reach === undefined
        ? {}
        : { target: (s: C) => reached.includes(s) };
    return m.cue({
      patch: kind.patch(k, kt) as never,
      ...whom,
      loop: named ? (c.loop ?? true) : true,
      ...(c.stagger === undefined ? {} : { stagger: c.stagger }),
      ...(c.rate === undefined ? {} : { rate: c.rate }),
      ...(c.role === undefined ? {} : { role: c.role }),
      ...(c.weight === undefined ? {} : { weight: c.weight }),
      ...(c.fade === undefined ? {} : { fade: c.fade }),
      ...(c.freeze === undefined ? {} : { freeze: c.freeze }),
    }) as unknown as Handle;
  });
  return { m, handles };
}

/** Whether a voice's time for `s` at `t` is on a pass edge or its start, where f32 may round across. */
function nearEdge(voices: readonly Voice<C, never>[], cues: Cue[], s: C, t: number): boolean {
  return voices.some((v, k) => {
    const raw = v.rawAt(t, cues[k]?.stagger?.(s) ?? 0);
    if (!Number.isFinite(raw)) return false;
    const off = raw - Math.round(raw / DURATION) * DURATION;
    return Math.abs(off) < 1e-3;
  });
}

/** Axis `a` of `channel` as `m` probes it for `s`. */
function probed(m: { probe(s: C): unknown }, s: C, channel: string, a: number): number {
  const v = (m.probe(s) as Record<string, number | number[]>)[channel];
  return (Array.isArray(v) ? (v[a] ?? 0) : v) as number;
}

/**
 * Plays the same voices on a gpu mix and a CPU mix and compares every subject at the script's
 * times, with `closeNear` only where a subject's time is on a pass edge or its start.
 */
async function agree(device: GpuDevice, kind: Kind, script: Script, named: boolean) {
  const g = make(kind, script.cues, named, gpu({ device }));
  const c = make(kind, script.cues, named, mixer);
  const cpuVoices = [...mixerOf(c.m).cued] as unknown as Voice<C, never>[];
  const side = gpuOf(g.m);
  let list = CELLS;
  side.subjects(list, fieldsOf);
  side.channel(kind.channel);
  await side.ready;
  const acts = script.acts ?? [];
  const all = [...new Set([...script.times, ...acts.map((a) => a.at)])].sort((a, b) => a - b);
  for (const t of all) {
    g.m.sync(t);
    c.m.sync(t);
    for (const a of acts)
      if (a.at === t) {
        a.act(g.handles);
        a.act(c.handles);
      }
    if (!script.times.includes(t)) continue;
    const ch = side.channel(kind.channel);
    if (script.cpuFrom !== undefined && t >= script.cpuFrom) {
      if (ch !== null) throw new Error(`the channel is on the GPU at ${t}, past ${script.cpuFrom}`);
      continue;
    }
    if (ch === null) throw new Error(`the channel is not on the GPU at ${t}`);
    const axes = ch.axes;
    const got = await readBack(device, ch.buffer, ch.offset, N * axes * 4);
    const tol = kind.tolerance;
    list.forEach((s, i) => {
      const near = nearEdge(cpuVoices, script.cues, s, t);
      for (let a = 0; a < axes; a++) {
        const what = `t ${t} subject ${s.id} axis ${a}`;
        const x = got[i * axes + a] as number;
        if (near) closeNear(x, (tt) => probed(c.m.project(tt), s, kind.channel, a), t, what, tol);
        else close(x, probed(c.m, s, kind.channel, a), what, tol);
      }
    });
    if (t === script.reorder) {
      list = CELLS.slice().sort((p, q) => rank(q) - rank(p));
      side.subjects(list, fieldsOf);
    }
  }
}

const fadeTwice = (ease?: Easing): Script => ({
  cues: [{ stagger: STAGGER, fade: { in: 400, out: 300, ...(ease ? { ease } : {}) } }],
  acts: [
    { at: 999, act: (h) => h[0]?.fade() },
    { at: 1150, act: (h) => h[0]?.rise() },
  ],
  // Turned back, its fade in stalls (spec conflict 2), which keeps it on the CPU.
  cpuFrom: 1150,
  times: [1, 250, 600, 999, 1100, 1149, 1150, 1700],
});

const CASES: [string, Script][] = [
  ['a looping staggered voice', { cues: [{ stagger: STAGGER }], times: [...TIMES, 1e6] }],
  [
    'a staggered voice cued backward',
    {
      cues: [
        { stagger: NEGATIVE, rate: -1, weight: 0.6 },
        { stagger: STAGGER, rate: -1, loop: 2 },
      ],
      times: [...TIMES, 1e6],
    },
  ],
  ['a staggered voice fading in, then out, then in again', fadeTwice()],
  [
    'a staggered voice fading in, then out, then in again, easing in and out',
    fadeTwice('ease-in-out'),
  ],
  [
    'staggered role members whose leader moves from subject to subject',
    {
      cues: [
        // At weight 0 and fading in, it still leads where it shows.
        { stagger: (c) => rank(c) * 3, role: 'r', weight: 0, fade: { in: 400 } },
        { stagger: STAGGER, role: 'r', weight: 0.7, fade: { in: 400 } },
        { weight: 0.4 },
        { stagger: (c) => (N - 1 - rank(c)) * 7, role: 'r', weight: 0.8 },
        // Masked out of the odd subjects.
        { stagger: (c) => rank(c) * 5, reach: (i) => i % 2 === 0, role: 'r', weight: 0.5 },
      ],
      times: [1, 250, 600, 999, 1000, 1700, 2600, 4100],
    },
  ],
  [
    'a rate change and a ramp while subjects are inside their delays',
    {
      cues: [{ stagger: STAGGER, loop: 3, fade: { in: 400 } }],
      acts: [
        {
          at: 300,
          act: (h) => {
            if (h[0]) h[0].rate = 0.5;
          },
        },
        { at: 700, act: (h) => h[0]?.ramp(2, 400) },
      ],
      times: [1, 250, 300, 500, 700, 900, 1100, 1700, 2600, 4100],
    },
  ],
  [
    "a seek on the voice's handle back into the delays",
    {
      cues: [{ stagger: STAGGER, fade: { in: 400 } }],
      acts: [{ at: 1500, act: (h) => h[0]?.seek(300) }],
      times: [1, 999, 1500, 1600, 2000, 2600, 4100],
    },
  ],
  [
    'subjects() called again in another order mid-play',
    {
      cues: [
        { stagger: STAGGER, fade: { in: 400 } },
        { stagger: NEGATIVE, reach: (i) => i % 3 !== 0, weight: 0.5, rate: -1 },
      ],
      reorder: 999,
      times: TIMES,
    },
  ],
  [
    'a staggered loop turned back past its start',
    {
      cues: [{ stagger: STAGGER }],
      acts: [
        {
          at: 1500,
          act: (h) => {
            if (h[0]) h[0].rate = -1;
          },
        },
      ],
      times: [1, 999, 1500, 2000, 2900, 3001, 4100],
    },
  ],
];

/** Named only: one asked as met with an end stays on the CPU (spec conflict 1). */
const PAST: [string, Script][] = [
  [
    "a staggered finite loop played past its last subject's end",
    {
      cues: [{ stagger: STAGGER, loop: 2 }],
      times: [1, 999, 2000, 2500, 3500, 3791.5, 3792.5, 5000],
    },
  ],
  [
    "a staggered finite loop played past its last subject's end, frozen after",
    {
      cues: [{ stagger: STAGGER, loop: 2, freeze: 'after' }],
      times: [1, 999, 2000, 2500, 3500, 3791.5, 3792.5, 5000],
    },
  ],
];

/** Asked as met and not beginless, a negative delay keeps it on the CPU (F3). */
const NEGATIVE_CASE: Script = { cues: [{ stagger: NEGATIVE, loop: 2 }], times: [...TIMES, 3000] };

for (const kind of KINDS) {
  for (const [name, script] of CASES) {
    test(`stagger (${kind.name}, named): ${name}`, (d) => agree(d, kind, script, true));
    test(`stagger (${kind.name}, asked as met): ${name}`, (d) => agree(d, kind, script, false));
  }
  for (const [name, script] of PAST)
    test(`stagger (${kind.name}, named): ${name}`, (d) => agree(d, kind, script, true));
  test(`stagger (${kind.name}, named): a staggered voice with negative delays`, (d) =>
    agree(d, kind, NEGATIVE_CASE, true));
  test(`stagger (${kind.name}, asked as met): a staggered voice with negative delays stays on the CPU`, (d) =>
    agree(d, kind, { ...NEGATIVE_CASE, cpuFrom: 0 }, false));
}
const roles = CASES.find(([n]) => n.startsWith('staggered role members')) as [string, Script];
test(`stagger (${STACKED.name}, named): ${roles[0]}`, (d) => agree(d, STACKED, roles[1], true));
test(`stagger (${STACKED.name}, asked as met): ${roles[0]}`, (d) =>
  agree(d, STACKED, roles[1], false));
