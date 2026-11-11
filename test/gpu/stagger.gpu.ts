import type { Easing } from '../../src/index.js';
import { agree, N, NEGATIVE, rank, type Script, STAGGER } from './agree.js';
import { test } from './harness.js';
import { KINDS, STACKED } from './kinds.js';

const TIMES = [1, 250, 999, 1000, 1700, 4100];

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
    'subjects sharing delays, some masked out, through a rate change and a seek back',
    {
      cues: [
        { stagger: (c) => (rank(c) % 5) * 90, fade: { in: 400 } },
        { stagger: (c) => (rank(c) % 3) * 200, reach: (i) => i % 3 !== 1, weight: 0.5 },
      ],
      acts: [
        {
          at: 150,
          act: (h) => {
            if (h[0]) h[0].rate = 0.5;
          },
        },
        { at: 1500, act: (h) => h[0]?.seek(100) },
      ],
      times: [1, 100, 150, 250, 400, 700, 999, 1500, 1600, 2000, 4100],
    },
  ],
  [
    'an unstarted voice holding its first frame, sought ahead on its handle',
    {
      cues: [{ stagger: STAGGER, freeze: 'before', start: 2000 }],
      acts: [{ at: 100, act: (h) => h[0]?.seek(500) }],
      times: [1, 100, 300, 1999, 2000, 2300, 4100],
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
