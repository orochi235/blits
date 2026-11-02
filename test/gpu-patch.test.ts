import { describe, expect, it } from 'vitest';
import { gpuDescriptor, shaderPatch } from '../src/gpu/shader-patch.js';
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
});
