import { level, slew } from '../../src/index.js';
import { agree, type C, N, type Script, STAGGER } from './agree.js';
import { test } from './harness.js';
import { KINDS, MOTIONS, moving, STACKED } from './kinds.js';

const TIMES = [1, 250, 450, 999, 1300, 2100, 4100];

/** A case's name, whether it staggers (so it also runs asked as met), and its script. */
type Case = [string, boolean, () => Script];

const sine = (c: C, s: { elapsed: number }) => 0.5 + 0.5 * Math.sin(c.id + s.elapsed / 300);
const gap = (_c: C, s: { dt: number }) => Math.min(1, s.dt / 4000);

const CASES: Case[] = [
  [
    'a level set between syncs',
    false,
    () => {
      const LEVEL = level<C>(1);
      return {
        cues: [{ weight: LEVEL }],
        // A voice's own signal is read at every probe, so both show 0.25 before the next sync.
        acts: [{ at: 999, after: true, act: () => LEVEL.set(0.25) }],
        times: TIMES,
      };
    },
  ],
  [
    'a signal reading the subject and its time',
    false,
    () => ({ cues: [{ weight: sine }], times: TIMES }),
  ],
  [
    'staggered and fading in, read per subject',
    true,
    () => ({
      cues: [{ stagger: STAGGER, fade: { in: 300 }, weight: (c: C) => (c.id % 5) / 4 }],
      times: TIMES,
    }),
  ],
  [
    'reads out of range',
    false,
    () => ({
      cues: [
        {
          weight: (c: C) =>
            [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.5, 1.7, 0.3][
              c.id % 6
            ] as number,
        },
        { weight: 0.4, fade: { in: 200 } },
      ],
      times: TIMES,
    }),
  ],
  [
    'read per subject, reordered',
    false,
    () => ({ cues: [{ weight: sine }], reorder: 999, times: TIMES }),
  ],
  [
    'read per subject under an owner weighted by a level',
    false,
    () => {
      const LEVEL = level<C>(1);
      return {
        owners: [{ weight: LEVEL, start: 100 }],
        cues: [{ owner: 0, weight: (c: C) => (c.id % 3) / 2 }],
        // An owner's signal is read once a frame on the CPU, so both keep 1 until the next sync.
        acts: [{ at: 999, after: true, act: () => LEVEL.set(0.5) }],
        times: TIMES,
      };
    },
  ],
  [
    'a signal reading dt per subject, across a handle seek, a touch and a reorder',
    true,
    () => ({
      cues: [{ stagger: STAGGER, weight: gap }],
      acts: [
        { at: 450, act: (h) => h[0]?.seek(100) },
        { at: 999, act: (_h, _p, m) => m.touch() },
      ],
      reorder: 1300,
      times: TIMES,
    }),
  ],
  [
    'a signal reading dt per subject, across mix seeks back',
    false,
    () => ({
      cues: [{ weight: gap }],
      history: true,
      acts: [
        { at: 999, act: (_h, _p, m) => m.seek(300) },
        { at: 2100, act: (_h, _p, m) => m.seek(1200) },
      ],
      times: TIMES,
    }),
  ],
  [
    'a slew stays on the CPU',
    false,
    () => ({
      cues: [{ weight: slew((c: C) => c.id / N, { riseMs: 200 }) }],
      cpuFrom: 0,
      times: TIMES,
    }),
  ],
];

for (const kind of [...KINDS, ...MOTIONS])
  for (const [name, staggers, script] of CASES) {
    test(`signals (${kind.name}, named): ${name}`, (d) => agree(d, kind, script(), true));
    if (staggers)
      test(`signals (${kind.name}, asked as met): ${name}`, (d) => agree(d, kind, script(), false));
  }

test(`signals (${STACKED.name}, named): a role member read per subject`, (d) =>
  agree(
    d,
    STACKED,
    {
      cues: [
        { role: 'r', weight: (c: C) => (c.id % 4) / 3 },
        { role: 'r', start: 200 },
      ],
      times: TIMES,
    },
    true,
  ));

for (const kind of MOTIONS)
  test(`signals (${kind.name}, named): retargets where a subject reads 0`, (d) =>
    agree(
      d,
      kind,
      {
        cues: [{ weight: (c: C) => c.id % 2 }],
        acts: [{ at: 250, act: moving(kind, [0], () => true) }],
        times: TIMES,
      },
      true,
    ));
