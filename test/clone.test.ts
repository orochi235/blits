import { describe, expect, it } from 'vitest';
import { clone, cloneInto } from '../src/clone.js';

describe('clone copies what structuredClone copies', () => {
  const shared = [1, 2];
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  const extra = Object.assign([1, 2, 3], { tag: 'x' });
  // biome-ignore lint/suspicious/noSparseArray: a hole is the case under test
  const holey = [1, , 3];
  const bare = Object.create(null) as Record<string, unknown>;
  bare.x = 2;
  const values: unknown[] = [
    0,
    -0,
    Number.NaN,
    'text',
    undefined,
    null,
    true,
    10n,
    { x: 0.1, y: -0, z: Number.POSITIVE_INFINITY },
    { pos: [1, 2, 3], gain: 0.5, on: true },
    [1, [2, 3], { a: 4 }],
    { deep: { deeper: { deepest: 1 } } },
    { a: shared, b: shared },
    cyclic,
    extra,
    holey,
    bare,
    new Date(0),
    new Map([[1, 2]]),
    new Float64Array([1, 2]),
    { [Symbol('s')]: 1, plain: 2 },
  ];

  it('gives the same value, never the same object', () => {
    for (const v of values) {
      const a = clone(v);
      const b = structuredClone(v);
      expect(a).toStrictEqual(b);
      if (typeof v === 'object' && v !== null) expect(a).not.toBe(v);
    }
  });

  it('keeps an object met twice as one, and a cycle as a cycle', () => {
    const c = clone({ a: shared, b: shared });
    expect(c.a).toBe(c.b);
    const d = clone(cyclic);
    expect(d.self).toBe(d);
  });

  it('keeps a property beside the elements, and a hole', () => {
    expect((clone(extra) as unknown as { tag: string }).tag).toBe('x');
    expect(1 in (clone(holey) as unknown[])).toBe(false);
  });

  it('refuses what structuredClone refuses', () => {
    expect(() => clone({ f: () => 1 })).toThrow();
    expect(() => clone(Symbol('s'))).toThrow();
  });

  it('writes over an object with the same keys, and gives what clone gives for every value', () => {
    const into = { x: 1, y: 2 };
    const got = cloneInto({ x: 0.5, y: -0 }, into);
    expect(got).toBe(into);
    expect(got).toStrictEqual({ x: 0.5, y: -0 });
    expect(cloneInto(bare, { x: 1 })).toStrictEqual(clone(bare));
    for (const v of values) {
      const target = { x: 1, y: 2, z: 3 };
      const a = cloneInto(v, target);
      expect(a).toStrictEqual(structuredClone(v));
      if (typeof v === 'object' && v !== null) expect(a).not.toBe(v);
    }
  });

  it('makes a new copy where the keys or their order differ, or a value is an object', () => {
    for (const [v, into] of [
      [
        { y: 1, x: 2 },
        { x: 0, y: 0 },
      ],
      [{ x: 1 }, { x: 0, y: 0 }],
      [{ x: 1, y: 2 }, { x: 0 }],
      [{ x: [1] }, { x: [0] }],
      [
        [1, 2],
        [0, 0],
      ],
      [{ x: 1 }, Object.assign(Object.create(null), { x: 0 })],
    ] as const) {
      const got = cloneInto(v, into);
      expect(got).not.toBe(into);
      expect(got).toStrictEqual(clone(v));
      expect(Object.keys(got)).toStrictEqual(Object.keys(v));
    }
  });
});
