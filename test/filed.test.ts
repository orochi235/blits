import { describe, expect, it } from 'vitest';
import { Filed, type Filer, Group } from '../src/filed.js';
import { mixerOf } from '../src/gpu/engine.js';
import { keys, kit, mix, sum } from '../src/index.js';

interface V extends Filer<number> {
  readonly named: { readonly list: readonly number[] };
}

const voice = (id: number, list: readonly number[]): V => ({ id, named: { list }, group: null });

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

/** Dead groups still listed. */
const dead = (f: Filed<number, V>) => (f as unknown as { dead: unknown[] }).dead.length;

/** What the index holds under a subject, groups as they are. */
const raw = (f: Filed<number, V>, s: number) =>
  (f as unknown as { lists: { get(s: number): unknown[] | undefined } }).lists.get(s);

describe('Filed', () => {
  it('lists each subject’s voices in voice order, few or many named alike', () => {
    const f = new Filed<number, V>();
    const many = range(2000);
    const a = voice(1, [1, 2]);
    const b = voice(2, many);
    const c = voice(3, [2, 3]);
    const d = voice(4, many.slice());
    for (const v of [d, a, c, b]) f.file(v);
    expect(f.get(2)).toEqual([a, b, c, d]);
    expect(f.get(1999)).toEqual([b, d]);
    expect(b.group).toBe(d.group);
    expect(b.group).toBeInstanceOf(Group);
    f.unfile(b);
    f.unfile(a);
    expect(f.get(2)).toEqual([c, d]);
    expect(f.get(1)).toEqual([d]);
    f.unfile(d);
    expect(f.get(1)).toBeUndefined();
    expect(f.get(3)).toEqual([c]);
  });

  it('files voices naming different lists of many apart', () => {
    const f = new Filed<number, V>();
    const a = voice(1, range(2000));
    const b = voice(2, range(2000, 1000));
    f.file(a);
    f.file(b);
    expect(a.group).not.toBe(b.group);
    expect(f.get(1500)).toEqual([a, b]);
    expect(f.get(500)).toEqual([a]);
    expect(f.get(2500)).toEqual([b]);
  });

  it('takes a dead group off its subjects a share at a time, sync by sync', () => {
    const f = new Filed<number, V>();
    const a = voice(1, range(100_000));
    const b = voice(2, [7]);
    f.file(a);
    f.file(b);
    f.unfile(a);
    expect(f.get(7)).toEqual([b]);
    expect(f.get(8)).toBeUndefined();
    let sweeps = 0;
    while (dead(f) > 0) {
      f.sweep();
      sweeps++;
      expect(sweeps).toBeLessThan(30);
    }
    expect(sweeps).toBeGreaterThan(1);
    expect(raw(f, 8)).toBeUndefined();
    expect(raw(f, 7)).toEqual([b]);
  });

  it('lets a voice naming a dead group’s list join it before the sweep begins, and not after', () => {
    const f = new Filed<number, V>();
    const list = range(50_000);
    const a = voice(1, list);
    f.file(a);
    f.unfile(a);
    const b = voice(2, list.slice());
    f.file(b);
    const g = b.group;
    expect(g).not.toBeNull();
    expect(dead(f)).toBe(0);
    f.unfile(b);
    f.sweep();
    const c = voice(3, list);
    f.file(c);
    expect(c.group).not.toBe(g);
    while (dead(f) > 0) f.sweep();
    expect(f.get(0)).toEqual([c]);
    expect(f.get(49_999)).toEqual([c]);
    expect(raw(f, 49_999)).toEqual([c.group]);
  });
});

describe('voices naming many subjects leaving the mix', () => {
  it('read as they did when taken off every subject at once', () => {
    const n = 5000;
    const cells = Array.from({ length: n }, (_, i) => ({ i }));
    const m = mix(kit({ x: sum() }), { name: 'filed' });
    m.sync(0);
    const ramp = (ms: number, to: number) =>
      keys(ms, [
        { at: 0, delta: { x: 0 } },
        { at: 1, delta: { x: to } },
      ]);
    m.cue({ patch: ramp(100, 4), subjects: cells });
    m.cue({ patch: ramp(1000, 10), subjects: cells });
    m.cue({ patch: ramp(100, 2), subjects: cells.slice(0, 3000) });
    m.sync(50);
    expect(m.probe(cells[3] as { i: number }).x).toBeCloseTo(2 + 0.5 + 1);
    expect(m.probe(cells[4000] as { i: number }).x).toBeCloseTo(2 + 0.5);
    m.sync(200);
    expect(m.probe(cells[3] as { i: number }).x).toBeCloseTo(2);
    const named = mixerOf(m).named;
    expect(named.get(cells[3] as { i: number })?.length).toBe(1);
    expect(named.get(cells[4000] as { i: number })?.length).toBe(1);
    m.sync(1200);
    let syncs = 0;
    while ((named as unknown as { dead: unknown[] }).dead.length > 0) {
      m.sync(1200 + ++syncs);
      expect(syncs).toBeLessThan(20);
    }
    expect(named.get(cells[0] as { i: number })).toBeUndefined();
    expect(m.probe(cells[0] as { i: number }).x).toBe(0);
  });
});

describe('Filed in two group slots', () => {
  it('files a voice in a gone index without moving it out of the named one', () => {
    const named = new Filed<number, V>();
    const gone = new Filed<number, V>('goneGroup');
    const many = range(2000);
    const a = voice(1, many);
    named.file(a);
    gone.file(a);
    expect(a.group).not.toBe(a.goneGroup);
    gone.unfile(a);
    expect(a.goneGroup).toBeNull();
    expect(named.get(5)).toEqual([a]);
    for (let i = 0; i < 10; i++) gone.sweep();
    expect(gone.get(5)).toBeUndefined();
  });
});
