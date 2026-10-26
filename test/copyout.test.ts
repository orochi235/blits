import { afterEach, describe, expect, it, vi } from 'vitest';
import { kit, last, mul, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';

interface Pose {
  x: number;
  'we"ird\\name': number;
  p: [number, number, number];
  l?: number;
  q?: [number, number];
}
interface Part {
  id: number;
}

const K = kit<Pose>({
  x: sum(),
  'we"ird\\name': mul(),
  p: vec(3, sum()),
  l: last<number>(),
  q: vec(2, last<number>()),
});

// The same channels in another order, whose copier is written out anew.
const K2 = kit<Pose>({
  q: vec(2, last<number>()),
  p: vec(3, sum()),
  l: last<number>(),
  'we"ird\\name': mul(),
  x: sum(),
});

const poses = (lanes: boolean, out: boolean, k = K) => {
  const m = mix<Part, Pose>(k, { lanes });
  m.cue({
    patch: keys<Part, Pose>(1000, [
      { at: 0, delta: { x: 0, 'we"ird\\name': 1, p: [0, 0, 0] } },
      { at: 0.5, delta: { x: 4, 'we"ird\\name': 0.5, p: [1, 2, 3], l: 7, q: [1, 2] } },
      { at: 1, delta: { x: 0, 'we"ird\\name': 1, p: [0, 0, 0] } },
    ]),
    loop: true,
  });
  const parts = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const seen: Pose[] = [];
  const into = {} as Pose;
  for (let t = 0; t <= 2000; t += 125) {
    m.sync(t);
    for (const s of parts) seen.push(structuredClone(out ? m.probe(s, into) : m.probe(s)));
  }
  return seen;
};

describe('copying laned values into a pose', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes what the general path writes, into a host out and into a pose of its own', () => {
    for (const out of [true, false]) expect(poses(true, out)).toEqual(poses(false, out));
  });

  it('writes the same where Function is refused, as under a content security policy', () => {
    vi.stubGlobal('Function', () => {
      throw new EvalError('refused');
    });
    const refused = poses(true, true, K2);
    vi.unstubAllGlobals();
    expect(refused).toEqual(poses(false, true, K2));
  });

  it('makes a plain object holding only the channels it has values for', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    m.sync(0);
    const pose = m.probe({ id: 1 });
    expect(Object.getPrototypeOf(pose)).toBe(Object.prototype);
    expect(Object.keys(pose)).toEqual(['x', 'we"ird\\name', 'p']);
  });
});
