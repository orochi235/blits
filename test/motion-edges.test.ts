import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { memoryStore } from './store.js';

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

describe.each([{ lanes: false }, { lanes: true }])(
  'a motion voice meeting subjects inside their stagger, lanes $lanes',
  ({ lanes }) => {
    const metOf = (m: unknown) => {
      const v = (m as { cued: { met: Iterable<unknown> | null; metRead: unknown[] | null }[] })
        .cued[0];
      return { met: [...(v?.met ?? [])], metRead: v?.metRead ?? [] };
    };

    it('keeps no subject dropped while it waited', () => {
      const m = mix<Part, Pose>(K, { lanes });
      m.sync(0);
      m.cue({ patch: spring<Part, Pose>('x', { to: 1 }), stagger: (s) => 1e6 + s.id });
      for (let i = 0; i < 1000; i++) {
        const s = { id: i };
        m.probe(s);
        m.drop(s);
      }
      expect(m.inert).toBe(false);
      expect(metOf(m).met).toHaveLength(0);
    });

    it('under history, keeps those it met and found read no longer than memory', () => {
      const m = mix<Part, Pose>(K, { lanes, history: { ms: 100 } });
      m.sync(0);
      // Each subject is met 14 ms before its stagger runs out, and read at the next frame.
      m.cue({ patch: spring<Part, Pose>('x', { to: 1 }), stagger: (s) => s.id * 16 + 30 });
      const live: Part[] = [];
      for (let i = 0; i < 2000; i++) {
        m.sync((i + 1) * 16);
        live.push({ id: i });
        for (const s of live) m.probe(s);
        void m.inert;
        if (live.length > 3) m.drop(live.shift() as Part);
      }
      const { met, metRead } = metOf(m);
      expect(met.length + metRead.length).toBeLessThan(40);
    });

    it('under a history store, keeps them no longer than memory either', () => {
      const store = memoryStore();
      const m = mix<Part, Pose>(K, {
        lanes,
        history: { ms: 100, tape, store },
        keyOf: (p: Part) => p.id,
      });
      m.sync(0);
      m.cue({ patch: spring<Part, Pose>('x', { to: 1 }), stagger: (s) => s.id * 16 + 30 });
      const live: Part[] = [];
      for (let i = 0; i < 4000; i++) {
        m.sync((i + 1) * 16);
        live.push({ id: i });
        for (const s of live) m.probe(s);
        void m.inert;
        if (live.length > 3) m.drop(live.shift() as Part);
      }
      const { met, metRead } = metOf(m);
      expect(met.length + metRead.length).toBeLessThan(80);
    });

    it('under a history store, a seek past memory puts back those met and unread then', async () => {
      // `x` is met at 16, inside its stagger, and read again only from 160; then churn carries
      // memory well past both, paging out the note that `x` left `met`.
      const play = () => {
        const m = mix<Part, Pose>(K, {
          lanes,
          history: { ms: 100, tape, store: memoryStore() },
          keyOf: (p: Part) => p.id,
        });
        const x = { id: -1 };
        const at = new Map<number, { inert: boolean; met: unknown[] }>();
        m.sync(0);
        m.cue({
          patch: spring<Part, Pose>('x', { to: 1 }),
          stagger: (s) => (s.id < 0 ? 40 : s.id * 16 + 200),
        });
        const live: Part[] = [];
        for (let i = 1; i <= 250; i++) {
          const t = i * 16;
          m.sync(t);
          if (t === 16 || t >= 160) m.probe(x);
          if (i >= 12) {
            live.push({ id: i });
            for (const s of live) m.probe(s);
            if (live.length > 3) m.drop(live.shift() as Part);
          }
          at.set(t, { inert: m.inert, met: metOf(m).met });
        }
        return { m, at };
      };
      const straight = play();
      expect(straight.at.get(48)?.met).toEqual([{ id: -1 }]);
      for (const t of [48, 96, 144]) {
        const run = play();
        await run.m.prepare(t);
        run.m.seek(t);
        expect(run.m.inert).toBe(straight.at.get(t)?.inert);
        expect(metOf(run.m).met).toEqual(expect.arrayContaining(straight.at.get(t)?.met ?? []));
      }
    });
  },
);
