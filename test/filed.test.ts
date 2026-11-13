import { describe, expect, it } from 'vitest';
import { Filed, type Filer, Group } from '../src/filed.js';
import { mixerOf } from '../src/gpu/engine.js';
import { keys, kit, mix, sum } from '../src/index.js';

interface V extends Filer<number> {
  readonly named: { readonly list: readonly number[]; has(subject: number): boolean };
}

/** How many times any voice's `has` has been asked. */
let asked = 0;

const voice = (id: number, list: readonly number[]): V => {
  const set = new Set(list);
  return {
    id,
    named: {
      list,
      has: (s: number) => {
        asked++;
        return set.has(s);
      },
    },
    group: null,
  };
};

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

/** Dead groups still listed. */
const dead = (f: Filed<number, V>) => (f as unknown as { dead: unknown[] }).dead.length;

/** Sweeps until no dead group is left to take off. */
const settle = (f: Filed<number, V>) => {
  for (let i = 0; dead(f) > 0; i++) {
    f.sweep();
    expect(i).toBeLessThan(100);
  }
};

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
    for (let s = 0; s < 100_000; s++) f.get(s);
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
    const list = range(3000);
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
    settle(f);
    expect(f.get(0)).toEqual([c]);
    expect(f.get(2999)).toEqual([c]);
    expect(raw(f, 2999)).toEqual([c.group]);
  });
});

describe('Filed listing a long list where get asks', () => {
  it('lists a long group under a subject only once get asks for it, in voice order', () => {
    const f = new Filed<number, V>();
    const a = voice(2, range(20_000));
    const b = voice(1, [5]);
    const c = voice(3, [5]);
    for (const v of [a, b, c]) f.file(v);
    f.sweep();
    expect(raw(f, 19_999)).toBeUndefined();
    expect(f.get(5)).toEqual([b, a, c]);
    expect(raw(f, 5)).toEqual([b, c, a.group]);
    expect(f.get(19_999)).toEqual([a]);
    expect(raw(f, 19_999)).toEqual([a.group]);
    expect(raw(f, 0)).toBeUndefined();
    expect(f.get(20_000)).toBeUndefined();
    expect(raw(f, 20_000)).toBeUndefined();
    const d = voice(4, range(20_000));
    f.file(d);
    expect(d.group).toBe(a.group);
    expect(f.get(19_999)).toEqual([a, d]);
    expect(f.get(5)).toEqual([b, a, c, d]);
    expect(raw(f, 19_999)).toEqual([a.group]);
  });

  it('asks a subject’s long groups once, and later only those made since', () => {
    const f = new Filed<number, V>();
    const many = range(12, 1).map((id) => voice(id, range(10_000, (id - 1) * 5000)));
    for (const v of many) f.file(v);
    asked = 0;
    expect(f.get(12_000)).toEqual([many[1], many[2]]);
    expect(asked).toBe(12);
    asked = 0;
    expect(f.get(12_000)).toEqual([many[1], many[2]]);
    expect(f.get(12_000)).toEqual([many[1], many[2]]);
    expect(asked).toBe(0);
    const late = voice(20, range(9000, 10_000));
    f.file(late);
    expect(f.get(12_000)).toEqual([many[1], many[2], late]);
    expect(asked).toBe(1);
    expect(raw(f, 12_000)).toEqual([many[1]?.group, many[2]?.group, late.group]);
    f.unfile(many[1] as V);
    asked = 0;
    expect(f.get(12_000)).toEqual([many[2], late]);
    expect(asked).toBe(0);
  });

  it('forgets a long group get never listed the moment its last voice leaves', () => {
    const f = new Filed<number, V>();
    const list = range(10_000);
    const a = voice(1, list);
    const b = voice(2, list.slice());
    f.file(a);
    f.file(b);
    expect(b.group).toBe(a.group);
    f.unfile(a);
    f.unfile(b);
    expect(dead(f)).toBe(0);
    expect(f.get(9999)).toBeUndefined();
  });

  it('takes a dead long group off where get listed it, and never lets a voice join it again', () => {
    const f = new Filed<number, V>();
    const list = range(20_000);
    const a = voice(1, list);
    f.file(a);
    expect(f.get(0)).toEqual([a]);
    const g = a.group;
    f.unfile(a);
    expect(f.get(0)).toBeUndefined();
    expect(dead(f)).toBe(1);
    const b = voice(2, list);
    f.file(b);
    expect(b.group).not.toBe(g);
    expect(f.get(0)).toEqual([b]);
    expect(f.get(19_999)).toEqual([b]);
    settle(f);
    expect(raw(f, 0)).toEqual([b.group]);
    expect(raw(f, 1)).toBeUndefined();
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
