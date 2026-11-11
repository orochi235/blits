import { setLeast } from '../../src/gpu/anchors.js';
import { agree, N, NEGATIVE, rank, type Script, STAGGER } from './agree.js';
import { test } from './harness.js';
import { MOTIONS, type Motion, moving } from './kinds.js';

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

/** Played past the re-anchor 40 rows a frame, so for some frames rows count from each anchor. */
const split = (kind: Motion): Script => ({
  cues: [{ stagger: STAGGER }],
  acts: [
    { at: 500, act: moving(kind, [0], (i) => i % 2 === 0) },
    { at: 16450, act: moving(kind, [0], (i) => i % 5 === 0) },
  ],
  times: [1, 500, 16000, ...Array.from({ length: 12 }, (_, k) => 16400 + 16 * k), 17500],
});

for (const kind of MOTIONS) {
  test(`motion stagger (${kind.name}, named): moving its rows to a new anchor over frames`, async (d) => {
    const was = setLeast(40);
    try {
      return await agree(d, kind, split(kind), true);
    } finally {
      setLeast(was);
    }
  });
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
