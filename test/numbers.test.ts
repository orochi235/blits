import { describe, expect, it } from 'vitest';
import { absent, Numbers } from '../src/numbers.js';

describe('Numbers', () => {
  it('hands out 0, 1, 2 and reuses a released number', () => {
    const freed: number[] = [];
    const n = new Numbers<string>((slot) => freed.push(slot));
    expect([n.take('a'), n.take('b'), n.take('c')]).toEqual([0, 1, 2]);
    n.release(1);
    expect(freed).toEqual([1]);
    expect(n.subject(1)).toBe(absent);
    expect(n.take('d')).toBe(1);
    expect(n.subject(1)).toBe('d');
    expect(n.size).toBe(3);
  });

  it('releases a number once, however often it is asked', () => {
    const freed: number[] = [];
    const n = new Numbers<string>((slot) => freed.push(slot));
    n.take('a');
    n.release(0);
    n.release(0);
    expect(freed).toEqual([0]);
  });

  it('holds an object subject weakly and hands it back while it lives', () => {
    const n = new Numbers<{ id: number }>(() => {});
    const part = { id: 7 };
    const slot = n.take(part);
    expect(n.subject(slot)).toBe(part);
  });
});
