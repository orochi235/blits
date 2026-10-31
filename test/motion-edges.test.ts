import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';

interface Pose {
  x: number;
  p: number[];
}
interface Part {
  id: number;
}
const K = kit<Pose>({ x: sum(), p: vec(2, sum()) });

describe('fit end to end', () => {
  const ramp = (ms: number) =>
    keys<Part, Pose>(
      ms,
      [
        { at: 0, delta: { x: 0 } },
        { at: 1, delta: { x: 100 } },
      ],
      { ease: 'linear' },
    );
  for (const [name, budget, natural, hint] of [
    ['slower', 1000, 100, { slower: Number.POSITIVE_INFINITY }],
    ['faster', 100, 1000, { faster: Number.POSITIVE_INFINITY }],
  ] as const) {
    it(`a child with ${name}: Infinity is retimed to fill a ${budget} ms span`, () => {
      const m = mix<Part, Pose>(K);
      const s = m.span({ duration: budget });
      const a = { id: 0 };
      m.cue({
        owner: s,
        patch: ramp(natural),
        subjects: [a],
        loop: false,
        freeze: 'after',
        ...hint,
      });
      m.sync(0);
      m.sync(budget / 2);
      expect(m.probe(a).x).toBeCloseTo(50, 3);
    });
  }
});

describe("from: 'current' on a vec", () => {
  for (const lanes of [false, true]) {
    it(`a still subject and a stop shorter than the channel's axes read as rest, not NaN, lanes ${lanes}`, () => {
      const m = mix<Part, Pose>(K, { lanes });
      const a = { id: 0 };
      const held = m.cue({
        patch: patch<Part, Pose>(1000, () => ({ p: [10, 20] }), { writes: ['p'] }),
      });
      m.sync(0);
      m.probe(a);
      m.sync(400);
      m.probe(a);
      held.weight = 0;
      m.cue({ patch: keys<Part, Pose>(1000, [{ at: 1, delta: { p: [5] } }]), from: 'current' });
      m.sync(416);
      m.probe(a);
      m.sync(900);
      expect(m.probe(a).p.every(Number.isFinite)).toBe(true);
    });
  }
});

describe('a motion with an infinite parameter', () => {
  it('throws, where it read NaN or jumped to its target', () => {
    expect(() => glide<Part, Pose>('x', { from: 0, ms: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => glide<Part, Pose>('x', { from: 0, stiffness: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    for (const k of ['stiffness', 'damping', 'mass'] as const)
      expect(() =>
        spring<Part, Pose>('x', { from: 0, to: 1, [k]: Number.POSITIVE_INFINITY }),
      ).toThrow(RangeError);
  });
});
