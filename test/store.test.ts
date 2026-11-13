import { describe, expect, it } from 'vitest';
import { Along, type Stand, Store } from '../src/store.js';

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

describe('Along', () => {
  /** A line of copies, each taking a key on from the one before as `${before}>`, `live` at the root. */
  function line(n: number) {
    const shared = new Store<string, Stand<string>>();
    const made: string[] = [];
    const copies: Along<string, string>[] = [];
    for (let at = 0; at < n; at++)
      copies.push(
        new Along(shared, at, (key, before, known) => {
          made.push(`${at}${known ? '+' : ''}`);
          const prev = at === 0 ? `live:${key}` : known ? before : copies[at - 1]?.get(key);
          return prev === undefined ? undefined : `${prev}>`;
        }),
      );
    return { shared, made, copies };
  }

  it('takes a key read forward on from the copy before, keeping one entry for the line', () => {
    const { shared, made, copies } = line(3);
    expect(copies.map((c) => c.get('a'))).toEqual(['live:a>', 'live:a>>', 'live:a>>>']);
    expect(made).toEqual(['0', '1+', '2+']);
    expect(shared.get('a')).toMatchObject({ value: 'live:a>>>', at: 2, gone: false });
  });

  it('walks back to the copy holding a key, past copies that never read it', () => {
    const { made, copies } = line(4);
    copies[0]?.get('a');
    expect(copies[3]?.get('a')).toBe('live:a>>>>');
    expect(made).toEqual(['0', '3', '2', '1+']);
    expect(copies[2]?.get('a')).toBe('live:a>>>');
  });

  it('answers a deleted key at its copy, and the value before it at the copies before', () => {
    const { copies } = line(3);
    copies[0]?.set('a', 'x');
    copies[1]?.set('a', 'x');
    copies[2]?.delete('a');
    expect(copies[2]?.get('a')).toBeUndefined();
    expect([copies[0]?.get('a'), copies[1]?.get('a')]).toEqual(['x', 'x']);
    copies[2]?.set('a', 'y');
    expect(copies[2]?.get('a')).toBe('y');
  });

  it('keeps what a copy behind the line writes to itself', () => {
    const { copies } = line(3);
    copies[2]?.set('a', 'z');
    copies[1]?.set('a', 'own');
    expect(copies.map((c) => c.get('a'))).toEqual(['live:a>', 'own', 'z']);
    copies[1]?.delete('a');
    expect(copies[1]?.get('a')).toBeUndefined();
    expect(copies[2]?.get('a')).toBe('z');
  });
});
