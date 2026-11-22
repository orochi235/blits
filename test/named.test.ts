import { describe, expect, it } from 'vitest';
import { Named } from '../src/named.js';

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
});
