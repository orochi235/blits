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

  const collect = async (alive: () => boolean) => {
    setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc') as () => void;
    for (let i = 0; i < 40 && alive(); i++) {
      await new Promise((r) => setTimeout(r, 0));
      gc();
    }
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('never hears of a released subject collected after its number went to another', async () => {
    const freed: number[] = [];
    const n = new Numbers<object>({ forget: (slot) => freed.push(slot) });
    const keep = [{}, {}];
    for (const k of keep) n.take(k);
    let ref: WeakRef<object> | null = null;
    const slot = (() => {
      const gone = {};
      ref = new WeakRef(gone);
      return n.take(gone);
    })();
    n.release(slot);
    const next = {};
    expect(n.take(next)).toBe(slot);
    await collect(() => ref?.deref() !== undefined);
    expect(ref?.deref()).toBeUndefined();
    expect(freed).toEqual([slot]);
    expect(n.subject(slot)).toBe(next);
  });

  it('releases a collected subject once, though it was released and numbered again before', async () => {
    const freed: number[] = [];
    const n = new Numbers<object>({ forget: (slot) => freed.push(slot) });
    const first = {};
    n.take(first);
    let ref: WeakRef<object> | null = null;
    const slot = (() => {
      const s = {};
      ref = new WeakRef(s);
      const a = n.take(s);
      for (let i = 0; i < 3000; i++) {
        n.release(a);
        n.take(s);
      }
      return a;
    })();
    await collect(() => ref?.deref() !== undefined);
    expect(ref?.deref()).toBeUndefined();
    expect(freed.length).toBe(3001);
    expect(freed.every((f) => f === slot)).toBe(true);
    expect(n.subject(slot)).toBe(absent);
    expect(n.subject(0)).toBe(first);
  });

  it("still releases a live subject's number when collected after many others were taken and released", async () => {
    const freed: number[] = [];
    const n = new Numbers<object>({ forget: (slot) => freed.push(slot) });
    const live = Array.from({ length: 100 }, () => ({}));
    for (const s of live) n.take(s);
    const churn = {};
    for (let i = 0; i < 5000; i++) n.release(n.take(churn));
    let ref: WeakRef<object> | null = null;
    const slot = (() => {
      const s = {};
      ref = new WeakRef(s);
      return n.take(s);
    })();
    freed.length = 0;
    await collect(() => ref?.deref() !== undefined);
    expect(freed).toEqual([slot]);
    for (const [i, s] of live.entries()) expect(n.subject(i)).toBe(s);
  });
});
