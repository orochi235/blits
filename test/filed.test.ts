import { describe, expect, it } from 'vitest';
import { Filed, type Filer, type Unfiled } from '../src/filed.js';
import { mixerOf } from '../src/gpu/engine.js';
import { keys, kit, mix, sum } from '../src/index.js';

interface V extends Filer<number> {
  readonly id: number;
  readonly named: { readonly list: readonly number[] };
  filed: object | null;
  unfiled: Unfiled | null;
}

const voice = (id: number, list: number[]): V => ({
  id,
  named: { list },
  filed: null,
  unfiled: null,
});

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

const queued = (f: Filed<number, V>) => (f as unknown as { queue: unknown[] }).queue.length;

describe('Filed', () => {
  it('lists each subject’s voices in the order filed, and none gone', () => {
    const f = new Filed<number, V>();
    const a = voice(1, [1, 2]);
    const b = voice(2, [2, 3]);
    f.file(a);
    f.file(b);
    expect(f.get(2)).toEqual([a, b]);
    f.unfile(a);
    expect(f.get(2)).toEqual([b]);
    expect(f.get(1)).toBeUndefined();
    expect(f.get(3)).toEqual([b]);
  });

  it('takes a gone voice off its subjects a share at a time, sync by sync', () => {
    const f = new Filed<number, V>();
    const n = 100_000;
    const a = voice(1, range(n));
    const b = voice(2, [7]);
    f.file(a);
    f.file(b);
    f.unfile(a);
    let sweeps = 0;
    while (queued(f) > 0) {
      f.sweep();
      sweeps++;
      expect(sweeps).toBeLessThan(20);
    }
    expect(sweeps).toBeGreaterThan(1);
    expect(a.unfiled).toBeNull();
    expect(f.get(7)).toEqual([b]);
    expect(f.get(8)).toBeUndefined();
  });

  it('stops sweeping a voice once readers have taken off all it had listed', () => {
    const f = new Filed<number, V>();
    const a = voice(1, range(50_000));
    f.file(a);
    f.unfile(a);
    for (let s = 0; s < 50_000; s++) f.get(s);
    expect((a.unfiled as Unfiled).left).toBe(0);
    f.sweep();
    expect(queued(f)).toBe(0);
  });

  it('takes several gone voices off a subject in one look', () => {
    const f = new Filed<number, V>();
    const list = range(30_000);
    const vs = [voice(1, list), voice(2, list), voice(3, list)];
    for (const v of vs) f.file(v);
    for (const v of vs) f.unfile(v);
    while (queued(f) > 0) f.sweep();
    for (const v of vs) expect(v.unfiled).toBeNull();
    expect(f.get(0)).toBeUndefined();
  });

  it('lists a voice filed again before its old entries went once, not twice', () => {
    const f = new Filed<number, V>();
    const a = voice(1, range(40_000));
    const b = voice(2, [5, 39_999]);
    f.file(a);
    f.file(b);
    f.unfile(a);
    f.sweep();
    f.file(a);
    expect(queued(f)).toBe(0);
    expect(f.get(5)).toEqual([b, a]);
    expect(f.get(39_999)).toEqual([b, a]);
    expect(f.get(0)).toEqual([a]);
  });
});

describe('a voice naming many subjects leaving the mix', () => {
  it('reads as it did when taken off every subject at once, and is swept off them by later syncs', () => {
    const n = 40_000;
    const cells = Array.from({ length: n }, (_, i) => ({ i }));
    const m = mix(kit({ x: sum() }), { name: 'filed' });
    m.sync(0);
    const short = keys(100, [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 4 } },
    ]);
    const long = keys(1000, [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 10 } },
    ]);
    m.cue({ patch: short, subjects: cells });
    m.cue({ patch: long, subjects: cells });
    m.sync(50);
    expect(m.probe(cells[3] as { i: number })).toEqual({ x: 2 + 0.5 });
    m.sync(200);
    expect(m.probe(cells[3] as { i: number })).toEqual({ x: 2 });
    const named = mixerOf(m).named as unknown as Filed<object, V>;
    let syncs = 0;
    while ((named as unknown as { queue: unknown[] }).queue.length > 0) {
      m.sync(200 + ++syncs);
      expect(syncs).toBeLessThan(20);
    }
    expect(m.probe(cells[n - 1] as { i: number }).x).toBeCloseTo((10 * (200 + syncs)) / 1000);
    expect(named.get(cells[n - 1] as object)?.length).toBe(1);
  });
});
