import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { absent, Numbers } from '../src/numbers.js';

describe('Numbers', () => {
  it('hands out 0, 1, 2 and reuses a released number', () => {
    const freed: number[] = [];
    const n = new Numbers<string>({ forget: (slot) => freed.push(slot) });
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
    const n = new Numbers<string>({ forget: (slot) => freed.push(slot) });
    n.take('a');
    n.release(0);
    n.release(0);
    expect(freed).toEqual([0]);
  });

  it('releases the first object numbered when it was collected before a second came', async () => {
    setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc') as () => void;
    const freed: number[] = [];
    const n = new Numbers<object>({ forget: (slot) => freed.push(slot) });
    const ref = (() => {
      const first = {};
      n.take(first);
      return new WeakRef(first);
    })();
    for (let i = 0; i < 20 && ref.deref() !== undefined; i++) {
      await new Promise((r) => setTimeout(r, 0));
      gc();
    }
    expect(ref.deref()).toBeUndefined();
    const second = {};
    expect(n.take(second)).toBe(1);
    expect(freed).toEqual([0]);
    expect(n.subject(0)).toBe(absent);
    expect(n.take({})).toBe(0);
    expect(n.subject(1)).toBe(second);
  });

  it('holds an object subject weakly and hands it back while it lives', () => {
    const n = new Numbers<{ id: number }>({ forget: () => {} });
    const part = { id: 7 };
    const slot = n.take(part);
    expect(n.subject(slot)).toBe(part);
  });
});
