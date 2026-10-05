import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';

describe('Store', () => {
  it('holds one id, then many, finding each through the move to a map', () => {
    const s = new Store<number, string>();
    s.set(7, 'a');
    expect(s.get(7)).toBe('a');
    s.set(7, 'b');
    expect(s.get(7)).toBe('b');
    s.set(8, 'c');
    s.set(9, 'd');
    expect([s.get(7), s.get(8), s.get(9), s.get(10)]).toEqual(['b', 'c', 'd', undefined]);
  });

  it('deletes the id it holds inline, and takes a new first one after', () => {
    const s = new Store<string, number>();
    s.set('x', 1);
    s.delete('x');
    expect(s.has('x')).toBe(false);
    s.set('y', 2);
    expect(s.get('y')).toBe(2);
    expect(s.get('x')).toBeUndefined();
  });

  it('deletes and clears across the inline id and the map alike', () => {
    const s = new Store<number, number>();
    s.set(1, 10);
    s.set(2, 20);
    s.delete(1);
    expect([s.get(1), s.get(2)]).toEqual([undefined, 20]);
    s.clear();
    expect(s.get(2)).toBeUndefined();
  });

  it('finds NaN as a Map would', () => {
    const s = new Store<number, string>();
    s.set(Number.NaN, 'nan');
    expect(s.get(Number.NaN)).toBe('nan');
    s.set(1, 'one');
    expect(s.get(Number.NaN)).toBe('nan');
  });

  it('keeps objects apart from ids, by identity', () => {
    const s = new Store<object | number, string>();
    const a = {};
    s.set(a, 'obj');
    s.set(0, 'zero');
    expect([s.get(a), s.get({}), s.get(0)]).toEqual(['obj', undefined, 'zero']);
  });
});
