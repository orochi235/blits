import { describe, expect, it } from 'vitest';
import { gpuDescriptor, shaderPack, shaderPatch } from '../src/gpu/shader-patch.js';
import { kit, mix, sum } from '../src/index.js';

interface C {
  x: number;
}
interface P {
  y: number;
}
const band = shaderPatch<C, P, { at: number }>(0, {
  params: { at: 'f32' },
  fields: { x: 'f32' },
  wgsl: 'out.y = subject.x - params.at;',
  at: (_phase, c, _s, p) => ({ y: c.x - p.at }),
  writes: ['y'],
});

describe('shaderPatch', () => {
  it('is a fn patch whose CPU paths run at with its parameters', () => {
    const m = mix<C, P>(kit<P>({ y: sum() }));
    const c = { x: 5 };
    m.cue({ patch: band.with({ at: 2 }), subjects: [c] });
    m.sync(0);
    expect(m.probe(c).y).toBe(3);
  });

  it('shares one shader between patches made with with', () => {
    const a = band.with({ at: 1 });
    const b = band.with({ at: 2 });
    expect(gpuDescriptor(a)?.shader).toBe(gpuDescriptor(b)?.shader);
    expect(gpuDescriptor(a)?.values).toEqual([1]);
  });

  it('refuses a name that is not a WGSL identifier', () => {
    expect(() =>
      shaderPatch<C, P>(0, {
        fields: { 'x-1': 'f32' },
        wgsl: '',
        at: () => ({}),
        writes: ['y'],
      }),
    ).toThrow(/WGSL identifier/);
  });

  it('refuses a value missing from with', () => {
    expect(() => band.with({} as { at: number })).toThrow(/at/);
  });

  it('has no GPU descriptor on a plain patch', () => {
    expect(gpuDescriptor({ form: 'fn' })).toBeUndefined();
  });

  describe('tables', () => {
    const lookup = shaderPatch<C, P, Record<never, never>, 'bitmap'>(0, {
      tables: { bitmap: { width: 2, height: 4 } },
      wgsl: 'out.y = table_bitmap(1, 0);',
      at: (_phase, c, _s, p) => ({ y: p.bitmap(c.x, 0) }),
      writes: ['y'],
    });
    const read = (x: number, y: number) => {
      const t = shaderPatch<C, P, Record<never, never>, 'bitmap'>(0, {
        tables: { bitmap: { width: 2, height: 4 } },
        wgsl: '',
        at: (_phase, _c, _s, p) => ({ y: p.bitmap(x, y) }),
        writes: ['y'],
      }).with({ bitmap: [10, 11, 12, 13, 14, 15, 16, 17] });
      return t.at(0, { x: 0 }, undefined as never).y;
    };

    it('refuses a table named as a parameter', () => {
      expect(() =>
        shaderPatch<C, P, { a: number }, 'a'>(0, {
          params: { a: 'f32' },
          tables: { a: { width: 1, height: 1 } },
          wgsl: '',
          at: () => ({}),
          writes: ['y'],
        }),
      ).toThrow('both a parameter and a table');
    });

    it('types with() by what the patch declares', () => {
      const none = shaderPatch<C, P>(0, { wgsl: '', at: () => ({}), writes: ['y'] });
      // @ts-expect-error a patch with no parameters takes none
      expect(() => none.with({ foo: 1 })).not.toThrow();
      expect(() => lookup.with({ bitmap: [1, 2, 3, 4, 5, 6, 7, 8] })).not.toThrow();
    });

    it('refuses contents of the wrong length', () => {
      expect(() => lookup.with({ bitmap: [1, 2, 3, 4, 5, 6] })).toThrow(
        'blits: with() needs 2 × 4 numbers for the table bitmap',
      );
    });

    it('reads row-major, floors, and gives 0 outside', () => {
      expect(read(1, 0)).toBe(11);
      expect(read(0, 3)).toBe(16);
      expect(read(1.9, 2.5)).toBe(15);
      expect(read(-0.5, 0)).toBe(0);
      expect(read(-1, 0)).toBe(0);
      expect(read(2, 0)).toBe(0);
      expect(read(0, 4)).toBe(0);
    });

    it('puts the contents after the parameters, and rewrites table calls with their place', () => {
      const t = shaderPatch<C, P, { k: number }, 'a' | 'b'>(0, {
        params: { k: 'f32' },
        tables: { a: { width: 2, height: 1 }, b: { width: 3, height: 1 } },
        wgsl: 'out.y = table_b(table_a(0, 0), 0) + table_a(1, 0);',
        at: () => ({ y: 0 }),
        writes: ['y'],
      }).with({ k: 7, a: [1, 2], b: [3, 4, 5] });
      const d = gpuDescriptor(t);
      expect((shaderPack(t) as { values: Float32Array }).values).toEqual(
        Float32Array.of(7, 1, 2, 3, 4, 5),
      );
      expect(d?.runner.wgsl).toContain(
        'blits_table(base + 3u, 3u, 1u, f32(blits_table(base + 1u, 2u, 1u, f32(0), f32(0))), f32(0))',
      );
      expect(d?.runner.wgsl).toContain('blits_table(base + 1u, 2u, 1u, f32(1), f32(0))');
    });
  });
});
