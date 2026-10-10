import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

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
