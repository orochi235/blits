import { shaderPatch } from '../../src/gpu/shader-patch.js';
import { color, type Easing, type Kit, keys, kit, overlay, sum, wave } from '../../src/index.js';
import { agree, type C, type Kind, N, NEGATIVE, rank, type Script, STAGGER } from './agree.js';
import { test } from './harness.js';

const DURATION = 1000;
const TIMES = [1, 250, 999, 1000, 1700, 4100];

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
    period: DURATION,
    loops: true,
    patch: (k) => shader.with({ k: 1 + k }),
  },
  {
    name: 'wave',
    kit: sums,
    channel: 'v',
    period: DURATION,
    loops: true,
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
    period: DURATION,
    loops: true,
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
  period: DURATION,
  loops: true,
  tolerance: 1e-3,
  patch: (k) => disc.with(COLORS[k % COLORS.length] as { L: number; a: number; b: number }),
};

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
    'a staggered voice fading out only, then risen again',
    {
      // With no fade in nothing stalls, so it stays on the GPU through the rise.
      cues: [{ stagger: STAGGER, fade: { out: 300 } }],
      acts: [
        { at: 999, act: (h) => h[0]?.fade() },
        { at: 1150, act: (h) => h[0]?.rise() },
      ],
      times: [1, 250, 999, 1100, 1149, 1150, 1300, 1700],
    },
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
    'a mix-level seek back to before a rate change, then a new rate, inside the delays',
    {
      cues: [{ stagger: STAGGER, fade: { in: 400 } }],
      history: true,
      acts: [
        {
          at: 300,
          act: (h) => {
            if (h[0]) h[0].rate = 0.5;
          },
        },
        {
          at: 1000,
          // The new rate cuts the tape, so subjects the change at 300 passed start again here.
          act: (h, _p, m) => {
            m.seek(200);
            if (h[0]) h[0].rate = 2;
          },
        },
      ],
      times: [...new Set([300, 1000, ...Array.from({ length: 150 }, (_, k) => 16 * (k + 1))])],
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
