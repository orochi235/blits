import { gpu, gpuOf, mixerOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { level, mix, mixer } from '../../src/index.js';
import type { Voice } from '../../src/voice.js';
import {
  agree,
  type C,
  CELLS,
  fieldsOf,
  type Kind,
  N,
  nearEdge,
  probed,
  type Script,
  STAGGER,
} from './agree.js';
import { close, closeNear, readBack, test } from './harness.js';
import { KINDS, MOTIONS, type Motion, moving, STACKED } from './kinds.js';

const TIMES = [1, 250, 450, 999, 1300, 2100, 4100];

/** A case's name, whether it staggers (so it also runs asked as met), and its script. */
type Case = [string, boolean, () => Script];

const CASES: Case[] = [
  [
    "a child at its owner's start plus its own",
    false,
    () => ({
      owners: [{ start: 300 }],
      cues: [
        { owner: 0, start: 200 },
        { owner: 0, weight: 0.5 },
      ],
      times: TIMES,
    }),
  ],
  [
    "nested owners, as bree's program and scenes",
    true,
    () => ({
      owners: [{}, { owner: 0, start: 400 }, { owner: 0, start: 1400 }],
      cues: [{ owner: 1 }, { owner: 1, start: 100, stagger: STAGGER }, { owner: 2 }],
      times: TIMES,
    }),
  ],
  [
    'nested owners at differing rates',
    true,
    () => ({
      owners: [{ rate: 0.5 }, { owner: 0, start: 200, rate: 3 }],
      cues: [
        { owner: 1, stagger: STAGGER },
        { owner: 0, start: 300 },
      ],
      times: TIMES,
    }),
  ],
  [
    "an owner's rate, a ramp, and seeks forward and back",
    true,
    () => ({
      owners: [{ start: 100, rate: 2 }],
      cues: [{ owner: 0, stagger: STAGGER, fade: { in: 300 } }],
      acts: [
        { at: 450, act: (_h, _p, _m, o) => o[0]?.ramp(0.5, 300) },
        { at: 1300, act: (_h, _p, _m, o) => o[0]?.seek(200) },
        { at: 2100, act: (_h, _p, _m, o) => o[0]?.seek(1500) },
      ],
      times: TIMES,
    }),
  ],
  [
    'an owner fading in and out, its weight written',
    false,
    () => ({
      owners: [{ weight: 0.6, fade: { in: 300, out: 400 } }],
      cues: [{ owner: 0, fade: { in: 200 } }],
      acts: [
        {
          at: 999,
          act: (_h, _p, _m, o) => {
            if (o[0]) o[0].weight = 0.3;
          },
        },
        { at: 1300, act: (_h, _p, _m, o) => o[0]?.fade() },
      ],
      times: [...TIMES, 1500, 1700],
    }),
  ],
  [
    "an owner run back past its children's starts",
    false,
    () => ({
      owners: [{}],
      cues: [
        { owner: 0, start: 200, loop: 3 },
        { owner: 0, start: 600 },
      ],
      acts: [
        {
          at: 999,
          act: (_h, _p, _m, o) => {
            if (o[0]) o[0].rate = -1;
          },
        },
      ],
      times: [...TIMES, 1500, 1700],
    }),
  ],
  [
    'a mix-level seek back under history',
    true,
    () => ({
      history: true,
      owners: [{ start: 100 }],
      cues: [{ owner: 0, stagger: STAGGER, fade: { in: 300 } }],
      acts: [{ at: 2100, act: (_h, _p, m) => m.seek(450) }],
      times: [...TIMES, 2101],
    }),
  ],
  [
    'a span fitting its children',
    false,
    () => ({
      owners: [{ span: { duration: 1500 } }],
      cues: [
        { owner: 0, loop: 1 },
        { owner: 0, loop: 1 },
      ],
      times: TIMES,
    }),
  ],
  [
    'an owner weighted by a level set between syncs',
    false,
    () => {
      const LEVEL = level<C>(1);
      return {
        owners: [{ weight: LEVEL }],
        cues: [{ owner: 0 }],
        // On the CPU an owner's signal is read once a frame, so both keep 1 until the next sync.
        acts: [{ at: 999, after: true, act: () => LEVEL.set(0.25) }],
        times: TIMES,
      };
    },
  ],
  [
    'an owner weighted per subject stays on the CPU',
    false,
    () => ({
      owners: [{ weight: (c: C) => c.id / N }],
      cues: [{ owner: 0 }],
      cpuFrom: 0,
      times: TIMES,
    }),
  ],
];

const spans = (name: string) => name.startsWith('a span');
for (const kind of [...KINDS, ...MOTIONS])
  for (const [name, staggers, script] of CASES) {
    // A motion never ends, which a span cannot fit.
    if (spans(name) && !kind.loops) continue;
    test(`owners (${kind.name}, named): ${name}`, (d) => agree(d, kind, script(), true));
    if (staggers)
      test(`owners (${kind.name}, asked as met): ${name}`, (d) => agree(d, kind, script(), false));
  }

test(`owners (${STACKED.name}, named): role members under an owner`, (d) =>
  agree(
    d,
    STACKED,
    {
      owners: [{ start: 100, fade: { in: 300 } }],
      cues: [
        { owner: 0, role: 'r' },
        { owner: 0, role: 'r', start: 200 },
      ],
      times: TIMES,
    },
    true,
  ));

const retargets = (kind: Motion): Script => ({
  owners: [{ weight: 0 }],
  cues: [{ owner: 0 }],
  acts: [
    { at: 250, act: moving(kind, [0], (i) => i % 2 === 0) },
    {
      at: 999,
      act: (_h, _p, _m, o) => {
        if (o[0]) o[0].weight = 1;
      },
    },
  ],
  times: [1, 250, 450, 999, 1300, 2100],
});
for (const kind of MOTIONS)
  test(`owners (${kind.name}, named): retargets while an owner's weight is 0`, (d) =>
    agree(d, kind, retargets(kind), true));

/** An arc whose parts are the kind's patches 0, 1 and 2, compared on the GPU and the CPU. */
async function arc(device: GpuDevice, kind: Kind) {
  const made = (engine: typeof mixer) => {
    const kt = kind.kit();
    const m = mix<C, never>(kt, { engine, name: 'arc' });
    m.sync(0);
    const part = (k: number) => ({ patch: kind.patch(k, kt) as never, subjects: CELLS });
    m.arc({ enter: part(0), active: part(1), exit: part(2), hold: 600, blend: 200 });
    return m;
  };
  const g = made(gpu({ device }));
  const c = made(mixer);
  const parts = ([...mixerOf(c).cued] as unknown as Voice<C, never>[]).filter(
    (v) => v.holding === null,
  );
  const side = gpuOf(g);
  side.subjects(CELLS, fieldsOf);
  side.channel(kind.channel);
  await side.ready;
  for (const t of [1, 150, 350, 700, 850, 1000, 1200]) {
    g.sync(t);
    c.sync(t);
    const ch = side.channel(kind.channel);
    if (ch === null) throw new Error(`the channel is not on the GPU at ${t}`);
    const got = await readBack(device, ch.buffer, ch.offset, N * ch.axes * 4);
    CELLS.forEach((s, i) => {
      const near = nearEdge(parts, [], s, t, kind.period);
      for (let a = 0; a < ch.axes; a++) {
        const what = `t ${t} subject ${s.id} axis ${a}`;
        const x = got[i * ch.axes + a] as number;
        const live = probed(c, s, kind.channel, a);
        const at = (tt: number) => (tt === t ? live : probed(c.project(tt), s, kind.channel, a));
        if (near) closeNear(x, at, t, what, kind.tolerance);
        else close(x, live, what, kind.tolerance);
      }
    });
  }
}

for (const kind of KINDS.filter((k) => k.name === 'wave' || k.name === 'keys'))
  test(`owners (${kind.name}, named): an arc's enter, active and exit`, (d) => arc(d, kind));
