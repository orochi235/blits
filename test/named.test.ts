import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { Named, Recent } from '../src/named.js';
import { patch } from '../src/patch.js';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('Named', () => {
  for (const [shape, of] of [
    ['an array', (xs: number[]) => xs],
    ['an iterable', (xs: number[]) => new Set(xs).values()],
  ] as const) {
    for (const n of [1, 8, 9, 40]) {
      it(`names ${n} distinct subjects from ${shape}, each with its stagger answer`, () => {
        const named = new Named(of(range(n)), (s) => s * 10);
        expect(named.list).toEqual(range(n));
        for (const s of range(n)) {
          expect(named.has(s)).toBe(true);
          expect(named.delayOf(s)).toBe(s * 10);
        }
        expect(named.has(n)).toBe(false);
        expect(named.delayOf(n)).toBeUndefined();
        expect(named.latest).toBe((n - 1) * 10);
      });
    }
  }

  for (const n of [5, 30]) {
    it(`keeps a subject named twice in ${n} once, at its first place`, () => {
      const subjects = [...range(n), 2, 0, ...range(n)];
      const asked: number[] = [];
      const named = new Named(subjects, (s) => {
        asked.push(s);
        return s + 1;
      });
      expect(named.list).toEqual(range(n));
      expect(asked).toEqual(range(n));
      expect(named.delayOf(2)).toBe(3);
    });
  }

  it('finds NaN as includes does, in a short list and a long one', () => {
    for (const n of [3, 20]) {
      const named = new Named([...range(n - 1), Number.NaN], () => 7);
      expect(named.has(Number.NaN)).toBe(true);
      expect(named.delayOf(Number.NaN)).toBe(7);
    }
  });

  it('has no delays without a stagger', () => {
    const named = new Named(range(20));
    expect(named.ordered).toBeNull();
    expect(named.delayOf(3)).toBeUndefined();
    expect(named.has(3)).toBe(true);
  });

  describe('sharing a long list with one recently named', () => {
    const subjects = range(2000).map((i) => ({ i }));

    it('shares the list of an equal one, each voice asking its own stagger', () => {
      const recent = new Recent<{ i: number }>();
      const a = new Named(subjects, (s) => s.i, recent);
      const b = new Named(subjects.slice(), (s) => s.i * 2, recent);
      expect(b.list).toBe(a.list);
      expect(b.has(subjects[7] as { i: number })).toBe(true);
      expect(b.has({ i: 7 })).toBe(false);
      expect(a.delayOf(subjects[7] as { i: number })).toBe(7);
      expect(b.delayOf(subjects[7] as { i: number })).toBe(14);
      expect(b.latest).toBe(3998);
    });

    it('builds its own where one subject differs, or one is named twice', () => {
      const recent = new Recent<{ i: number }>();
      const a = new Named(subjects, undefined, recent);
      const other = subjects.slice();
      const stranger = { i: -1 };
      other[1500] = stranger;
      const b = new Named(other, undefined, recent);
      expect(b.list).not.toBe(a.list);
      expect(b.has(stranger)).toBe(true);
      expect(b.has(subjects[1500] as { i: number })).toBe(false);
      const twice = subjects.slice();
      twice[1999] = subjects[0] as { i: number };
      const c = new Named(twice, undefined, recent);
      expect(c.list).not.toBe(a.list);
      expect(c.size).toBe(1999);
    });

    it('builds its own where the array was changed in place since', () => {
      const recent = new Recent<{ i: number }>();
      const given = subjects.slice();
      const a = new Named(given, undefined, recent);
      const moved = { i: 5000 };
      given[3] = moved;
      const b = new Named(given, undefined, recent);
      expect(b.list).not.toBe(a.list);
      expect(b.has(moved)).toBe(true);
      expect(a.has(moved)).toBe(false);
    });
  });

  it('reads two voices of a mix naming the same long list, each by its own stagger', () => {
    const cells = range(2000).map((i) => ({ i }));
    const m = mix<{ i: number }, { x: number }>(kit({ x: sum() }));
    m.sync(0);
    const ramp = patch(100, (ph) => ({ x: ph }), { writes: ['x'] });
    m.cue({ patch: ramp, subjects: cells, stagger: (c) => (c.i % 2) * 50 });
    m.cue({ patch: ramp, subjects: cells.slice(), stagger: (c) => (c.i % 3) * 25 });
    m.sync(50);
    const out = { x: 0 };
    for (const i of [0, 1, 2, 3, 1999]) {
      m.probe(cells[i] as { i: number }, out);
      const a = Math.max(0, 50 - (i % 2) * 50) / 100;
      const b = Math.max(0, 50 - (i % 3) * 25) / 100;
      expect(out.x).toBeCloseTo(a + b, 9);
    }
  });
});
