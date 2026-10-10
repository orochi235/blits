import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring, tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import type { Handle, Mix } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Row {
  id: number;
}

/** Deterministic noise, so a failing step can be replayed. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Pick = (n: number) => number;
type Act = (m: Mix<Row, Pose>, hs: Handle<Row>[], rs: Row[], pick: Pick) => void;

const acts: Act[] = [
  (m, hs, _rs, pick) =>
    hs.push(
      m.cue({
        patch: keys<Row, Pose>(100 + pick(400), [
          { at: 0, delta: { x: 0 } },
          { at: 1, delta: { x: 1 } },
        ]),
        loop: [true, false, 2, 3][pick(4)] as boolean | number,
        fade: { in: pick(2) * 100, out: pick(2) * 150 },
        stagger: pick(2) === 0 ? undefined : (r) => r.id * 40,
        freeze: ([undefined, 'before', 'after', 'both'] as const)[pick(4)],
      }),
    ),
  (m, hs, rs, pick) =>
    hs.push(
      m.cue({
        patch: patch<Row, Pose>(200 + pick(300), () => ({ gain: 0.5 }), { writes: ['gain'] }),
        loop: 1 + pick(3),
        subjects: [rs[pick(rs.length)] as Row],
        name: `n${hs.length}`,
        anchor:
          hs.length > 0 && pick(2) === 0 ? { start: { after: `n${hs.length - 1}` } } : undefined,
      }),
    ),
  (m, hs, _rs, pick) =>
    hs.push(
      m.cue({ patch: tween<Row, Pose>('x', { from: 0, to: (r) => r.id, ms: 100 + pick(500) }) }),
    ),
  (m, hs) =>
    hs.push(m.cue({ patch: spring<Row, Pose>('x', { to: 1, stiffness: 120, damping: 14 }) })),
  (_m, hs, _rs, pick) => {
    const h = hs[pick(hs.length)];
    if (h) h.rate = [0, 0.5, 1, 2, -1][pick(5)] as number;
  },
  (_m, hs, _rs, pick) => hs[pick(hs.length)]?.ramp([0, 0.5, 2][pick(3)] as number, 50 + pick(400)),
  (_m, hs, _rs, pick) => hs[pick(hs.length)]?.seek(pick(1500)),
  (_m, hs, _rs, pick) => {
    const h = hs[pick(hs.length)];
    if (h) h.fade(pick(3) === 0 ? { at: 'rest', deadline: 400 } : { over: pick(3) * 120 });
  },
  (_m, hs, rs, pick) =>
    hs[pick(hs.length)]?.fade({ subject: rs[pick(rs.length)] as Row, over: pick(2) * 200 }),
  (m, _hs, _rs, pick) => m.announce(`a${pick(3)}`),
  (m, _hs, _rs, pick) => {
    if (pick(4) === 0) m.mute({ over: 200 });
  },
];

/**
 * Builds the same mix twice, one visiting every voice each sync as before the due queue, and plays
 * the same actions at the same uneven timestamps on both, comparing every voice's state, every
 * row's pose and the marks after each sync.
 */
function agree(seed: number, steps: number): void {
  const rows = Array.from({ length: 5 }, (_, id) => ({ id }));
  const runs = [false, true].map((walkAll) => {
    const m = mix<Row, Pose>(K);
    (m as unknown as { walkAll: boolean }).walkAll = walkAll;
    return { m, handles: [] as Handle<Row>[] };
  });
  const rand = noise(seed);
  let t = 0;
  for (let step = 0; step < steps; step++) {
    const act = acts[Math.floor(rand() * acts.length)] as Act;
    const draws = Math.floor(rand() * 2 ** 31);
    // Both runs take the same draws for this action.
    for (const run of runs) {
      const r = noise(draws);
      act(run.m, run.handles, rows, (n) => Math.floor(r() * n));
    }
    t += [0, 1, 16, 16, 33, 120, 500][Math.floor(rand() * 7)] as number;
    for (const run of runs) run.m.sync(t);
    const [a, b] = runs as [(typeof runs)[0], (typeof runs)[0]];
    const where = `seed ${seed} step ${step} t ${t}`;
    expect(
      a.handles.map((h) => h.state),
      `states, ${where}`,
    ).toEqual(b.handles.map((h) => h.state));
    for (const row of rows)
      expect(a.m.probe(row), `pose of ${row.id}, ${where}`).toEqual(b.m.probe(row));
    expect(a.m.marks(t - 2000, t + 2000), `marks, ${where}`).toEqual(b.m.marks(t - 2000, t + 2000));
  }
}

describe('sync by what is due', () => {
  for (let seed = 1; seed <= 40; seed++)
    it(`plays as visiting every voice does, seed ${seed}`, () => agree(seed, 300));
});
