import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';

interface Pose {
  x: number;
}
interface Part {
  id: number;
}
const K = kit<Pose>({ x: sum() });
const a: Part = { id: 0 };
const b: Part = { id: 1 };

/** A patch with no `step`, writing the `dt` it was handed. */
const gap = () => patch<Part, Pose>(10_000, (_, __, s) => ({ x: s.dt }), { writes: ['x'] });

// The three ways a voice holds a subject: a record each off lanes, a lane's row, and one record
// shared by every subject. A weight signal keeps a voice from sharing.
const paths = {
  'off lanes': { lanes: false, weight: 1 as const },
  'on a lane': { lanes: true, weight: () => 1 },
  'on a shared record': { lanes: true, weight: 1 as const },
};

describe.each(Object.entries(paths))('dt for a patch with no step, %s', (_, { lanes, weight }) => {
  it('is the gap since the subject was last sampled, not since its origin', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    m.cue({ patch: gap(), weight });
    const seen = [16, 48, 64, 80].map((t) => {
      m.sync(t);
      return [m.probe(a).x, m.probe(b).x];
    });
    expect(seen).toEqual([
      [16, 16],
      [32, 32],
      [16, 16],
      [16, 16],
    ]);
  });

  it('is the same for every probe of a subject in one frame', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    m.cue({ patch: gap(), weight });
    m.sync(16);
    m.probe(a);
    m.sync(32);
    expect([m.probe(a).x, m.probe(b).x, m.probe(a).x]).toEqual([16, 32, 16]);
  });

  it('hands a weight signal the same gap', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const flat = patch<Part, Pose>(10_000, () => ({ x: 1 }), { writes: ['x'] });
    m.cue({ patch: flat, weight: (_, s) => s.dt / 100 });
    const seen = [16, 48, 64].map((t) => {
      m.sync(t);
      return [m.probe(a).x, m.probe(a).x];
    });
    expect(seen).toEqual([
      [0.16, 0.16],
      [0.32, 0.32],
      [0.16, 0.16],
    ]);
  });
});

it('is the whole gap for a subject not sampled for a while, off lanes', () => {
  const m = mix<Part, Pose>(K, { lanes: false });
  m.sync(0);
  m.cue({ patch: gap() });
  for (let t = 16; t <= 160; t += 16) {
    m.sync(t);
    expect(m.probe(a).x).toBe(16);
    if (t === 16) expect(m.probe(b).x).toBe(16);
  }
  expect(m.probe(b).x).toBe(144);
});

// A weight signal at 0 for a while: its next read is handed the gap since the last silent one, as
// off lanes, not since the subject last gave a delta.
describe.each([
  ['fn', () => patch<Part, Pose>(10_000, () => ({ x: 1 }), { writes: ['x'] })],
  [
    'keys',
    () =>
      keys<Part, Pose>(10_000, [
        { at: 0, delta: { x: 1 } },
        { at: 1, delta: { x: 1 } },
      ]),
  ],
] as const)('a %s voice weighted silent for a while', (_, made) => {
  it('hands its signal the same dt on lanes as off them', () => {
    const [off, on] = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 100 }, (__, id) => ({ id }));
      let t = 0;
      m.sync(0);
      m.cue({ patch: made(), weight: (___, s) => (t >= 48 && t < 96 ? 0 : s.dt / 100) });
      const seen: number[] = [];
      for (t = 16; t <= 160; t += 16) {
        m.sync(t);
        for (const p of parts) seen.push(m.probe(p).x);
      }
      return seen;
    });
    expect(on).toEqual(off);
    expect(off?.at(-1)).toBeCloseTo(0.16);
  });
});

it('hands a motion voice signal the same gap on lanes as off them', () => {
  const [off, on] = [false, true].map((lanes) => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const seen: number[] = [];
    m.cue({
      patch: tween<Part, Pose>('x', { from: 0, to: 10, ms: 300 }),
      subjects: [a, b],
      weight: (p, s) => {
        if (p === a) seen.push(s.dt);
        return 1;
      },
    });
    for (const t of [16, 250, 450, 999]) {
      m.sync(t);
      m.probe(a);
      m.probe(b);
    }
    return seen;
  });
  expect(on).toEqual(off);
  expect(off).toEqual([16, 234, 200, 549]);
});

// A subject's first `dt` counts from its `since`, where its delay runs out or its voice starts, not
// from when it was first probed: the same start a stateful patch steps from.
describe.each([false, true])('a first dt, lanes %s', (lanes) => {
  const flat = () => patch<Part, Pose>(10_000, () => ({ x: 1 }), { writes: ['x'] });
  /** Each probe's dt the voice's signal was handed, as `subject@time:dt`, probing both every frame. */
  const run = (spec: object, frames: number[], seek?: [number, number]) => {
    const m = mix<Part, Pose>(K, { lanes, history: { ms: 5000, tape } });
    m.sync(0);
    const seen: string[] = [];
    const weight = (p: Part, s: { timestamp: number; dt: number }) => {
      seen.push(`${p.id}@${s.timestamp}:${s.dt}`);
      return 1;
    };
    m.cue({ patch: flat(), weight, ...spec });
    for (const t of frames) {
      m.sync(t);
      if (seek !== undefined && t === seek[0]) m.seek(seek[1]);
      m.probe(a);
      m.probe(b);
    }
    return seen;
  };
  const stagger = (p: Part) => p.id * 40;

  it('of a staggered subject counts from where its delay runs out', () => {
    expect(run({ stagger }, [10, 26, 42, 58])).toEqual([
      '0@10:10',
      '0@26:16',
      '0@42:16',
      '1@42:2',
      '0@58:16',
      '1@58:16',
    ]);
  });

  it('of a voice started ahead counts from its start', () => {
    expect(run({ start: 40 }, [10, 26, 42, 58])).toEqual([
      '0@42:2',
      '1@42:2',
      '0@58:16',
      '1@58:16',
    ]);
  });

  it('of a staggered subject counts from where its delay runs out after a seek back', () => {
    expect(run({ stagger }, [10, 26, 42, 58], [26, 20])).toEqual([
      '0@10:10',
      '0@20:20',
      '0@36:16',
      '0@52:16',
      '1@52:12',
    ]);
  });

  it('of a subject frozen before its delay runs out is 0', () => {
    expect(run({ stagger, freeze: 'before' }, [10, 26])).toEqual([
      '0@10:10',
      '1@10:0',
      '0@26:16',
      '1@26:16',
    ]);
  });

  it('of a stateful patch matches what its step is handed', () => {
    const steps: number[] = [];
    const stepping = patch<Part, Pose>(10_000, () => ({ x: 1 }), {
      writes: ['x'],
      state: () => 0,
      step: (_: unknown, dt: number, p: Part) => {
        if (p === b) steps.push(dt);
      },
    } as never);
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const reads: number[] = [];
    m.cue({
      patch: stepping,
      stagger,
      weight: (p, s) => {
        if (p === b) reads.push(s.dt);
        return 1;
      },
    });
    for (const t of [10, 26, 42, 58]) {
      m.sync(t);
      m.probe(a);
      m.probe(b);
    }
    expect(reads).toEqual([2, 16]);
    expect(steps).toEqual(reads);
  });
});
