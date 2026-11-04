import { glide, type Kit, kit, spring, sum, tween } from '../../src/index.js';
import {
  agree,
  type C,
  CELLS,
  type Kind,
  type Moving,
  N,
  NEGATIVE,
  rank,
  type Script,
  STAGGER,
} from './agree.js';
import { test } from './harness.js';

type V = { v: number };
const sums = () => kit<V>({ v: sum() }) as unknown as Kit<never>;

/** A motion kind, and how a script retargets one of its patches: a new goal, or a push for a glide. */
interface Motion extends Kind {
  move(p: Moving, s: C, k: number, at?: number): void;
}

const MOTIONS: Motion[] = [
  {
    name: 'spring',
    kit: sums,
    channel: 'v',
    period: 0,
    loops: false,
    patch: (k) =>
      spring<C, V>('v', {
        from: (c) => c.id % 7,
        to: (c) => 10 + k + (c.id % 5),
        stiffness: 180,
        damping: 12,
      }),
    move: (p, s, k, at) => p.to?.(s, 30 - s.id * 0.1 + k, at),
  },
  {
    name: 'tween',
    kit: sums,
    channel: 'v',
    period: 0,
    loops: false,
    patch: (k) =>
      tween<C, V>('v', {
        from: (c) => c.id % 9,
        to: (c) => 50 + k - (c.id % 4),
        ms: (c) => 300 + (c.id % 5) * 40,
        ease: 'ease-in-out',
      }),
    move: (p, s, k, at) => p.to?.(s, 7 + k + (s.id % 3), at),
  },
  {
    name: 'bounded glide',
    kit: sums,
    channel: 'v',
    period: 0,
    loops: false,
    // Its branch inside a run turns on time.
    near: true,
    patch: (k) =>
      glide<C, V>('v', {
        from: (c) => [50, 50, 120, -30][c.id % 4] as number,
        velocity: (c) => ([10 + c.id * 0.37, 400, -20, 10][c.id % 4] as number) + k * 5,
        bounds: [0, 100],
      }),
    move: (p, s, k, at) => p.push?.(s, (s.id % 2 === 0 ? 300 : -250) + k * 10, at),
  },
];

/** Moves every subject `keep` takes on each listed cue's patch, at subject time `at` if given. */
const moving =
  (kind: Motion, cues: number[], keep: (i: number) => boolean, at?: number) =>
  (_h: unknown, p: Moving[]) => {
    for (const k of cues) {
      const patch = p[k];
      if (patch !== undefined)
        CELLS.forEach((s, i) => {
          if (keep(i)) kind.move(patch, s, k, at);
        });
    }
  };

/** The scripts for one kind; each retargets mid-run, before and after some subjects start. */
function scripts(kind: Motion): [string, Script][] {
  return [
    [
      'retargeted before and after some subjects start, played past the re-anchor',
      {
        cues: [{ stagger: STAGGER }],
        acts: [
          { at: 500, act: moving(kind, [0], (i) => i % 2 === 0) },
          // At subject time 900: due before some subjects start and after others.
          { at: 600, act: moving(kind, [0], (i) => i % 2 === 1, 900) },
          { at: 17200, act: moving(kind, [0], (i) => i % 3 === 0) },
        ],
        times: [1, 250, 500, 600, 999, 1500, 2600, 17000, 17200, 17500],
      },
    ],
    [
      'fading in, reaching half, in a role, with a rate change and a ramp',
      {
        cues: [
          { stagger: STAGGER, fade: { in: 400 }, role: 'r', weight: 0.7 },
          { stagger: (c) => (N - 1 - rank(c)) * 5, reach: (i) => i % 2 === 0, role: 'r' },
          { weight: 0.3 },
        ],
        acts: [
          {
            at: 300,
            act: (h) => {
              if (h[0]) h[0].rate = 0.5;
            },
          },
          { at: 700, act: moving(kind, [0, 1, 2], (i) => i % 3 !== 1) },
          { at: 800, act: (h) => h[1]?.ramp(2, 400) },
        ],
        times: [1, 250, 300, 500, 700, 900, 1100, 1700, 2600, 4100],
      },
    ],
    [
      'fading out, then risen again',
      {
        cues: [{ stagger: STAGGER, fade: { out: 300 } }],
        acts: [
          { at: 600, act: moving(kind, [0], (i) => i % 2 === 0) },
          { at: 999, act: (h) => h[0]?.fade() },
          { at: 1100, act: moving(kind, [0], (i) => i % 2 === 1) },
          { at: 1150, act: (h) => h[0]?.rise() },
        ],
        times: [1, 600, 999, 1100, 1149, 1150, 1300, 1700, 2600],
      },
    ],
    [
      "sought back into its delays on the voice's handle",
      {
        cues: [{ stagger: STAGGER, fade: { in: 400 } }],
        acts: [
          { at: 900, act: moving(kind, [0], (i) => i % 2 === 0) },
          { at: 1500, act: (h) => h[0]?.seek(300) },
          { at: 1600, act: moving(kind, [0], (i) => i % 4 === 1) },
        ],
        times: [1, 900, 1500, 1600, 2000, 2600, 4100],
      },
    ],
  ];
}

/** Named only: asked as met, a voice that is not beginless with a negative delay stays on the CPU. */
const negative = (kind: Motion): Script => ({
  cues: [{ stagger: NEGATIVE }],
  acts: [
    { at: 250, act: moving(kind, [0], (i) => i % 2 === 0) },
    { at: 400, act: moving(kind, [0], (i) => i % 2 === 1, 700) },
  ],
  times: [1, 250, 400, 999, 1700, 4100],
});

for (const kind of MOTIONS) {
  for (const [name, script] of scripts(kind)) {
    test(`motion stagger (${kind.name}, named): ${name}`, (d) => agree(d, kind, script, true));
    test(`motion stagger (${kind.name}, asked as met): ${name}`, (d) =>
      agree(d, kind, script, false));
  }
  test(`motion stagger (${kind.name}, named): with negative delays`, (d) =>
    agree(d, kind, negative(kind), true));
  test(`motion stagger (${kind.name}, asked as met): with negative delays stays on the CPU`, (d) =>
    agree(d, kind, { ...negative(kind), cpuFrom: 0 }, false));
}
