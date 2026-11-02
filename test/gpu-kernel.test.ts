import { describe, expect, it } from 'vitest';
import { kernel } from '../src/gpu/kernel.js';
import type { Shader } from '../src/gpu/shader-patch.js';

const helper = 'fn twice(x: f32) -> f32 { return 2.0 * x; }';
const a: Shader = {
  wgsl: 'out.y = twice(phase);',
  helpers: helper,
  fields: ['x'],
  params: [],
  writes: ['y'],
};
const b: Shader = {
  wgsl: 'out.y = params.k; out.z = subject.x;',
  helpers: helper,
  fields: ['x', 'w'],
  params: ['k'],
  writes: ['y', 'z'],
};
const sum = { axes: 1, rest: [0], fold: 'acc[0] = acc[0] + v[0] * w;' };

describe('kernel', () => {
  const k = kernel(
    [a, b],
    new Map([
      ['y', sum],
      ['z', sum],
    ]),
    100,
  );
  it('holds a function and a switch arm per shader', () => {
    expect(k.code).toContain('fn patch_0(');
    expect(k.code).toContain('fn patch_1(');
    expect(k.code.match(/case 1u/g)).toHaveLength(2);
  });
  it('includes a shared helper once', () => {
    expect(k.code.split(helper)).toHaveLength(2);
  });
  it('lays the channels end to end, a subject at a time', () => {
    expect(k.outputs).toEqual([
      { name: 'y', axes: 1, offset: 0 },
      { name: 'z', axes: 1, offset: 100 },
    ]);
    expect(k.size).toBe(200);
  });
  it('gives every subject the union of the fields, sorted', () => {
    expect(k.fields).toEqual(['w', 'x']);
  });
  it('reads parameters from the values buffer at the voice offset', () => {
    expect(k.code).toContain('let params = Params_1(values[base + 0u]);');
  });
});
