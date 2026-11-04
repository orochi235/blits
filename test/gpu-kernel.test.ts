import { describe, expect, it } from 'vitest';
import { kernel, prefixed } from '../src/gpu/kernel.js';
import { packOf, type Runner } from '../src/gpu/runner.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { spring } from '../src/index.js';

type O = { y: number; z: number; v: number };
const helper = 'fn twice(x: f32) -> f32 { return 2.0 * x; }';
const a = shaderPatch<{ x: number }, O>(1000, {
  wgsl: 'out.y = twice(phase);',
  helpers: helper,
  fields: { x: 'f32' },
  at: () => ({}),
  writes: ['y'],
});
const b = shaderPatch<{ x: number; w: number }, O, { k: number }>(1000, {
  wgsl: 'out.y = params.k; out.z = subject.x;',
  helpers: helper,
  fields: { x: 'f32', w: 'f32' },
  params: { k: 'f32' },
  at: () => ({}),
  writes: ['y', 'z'],
});
const sum = { axes: 1, rest: [0], fold: 'acc[0] = acc[0] + v[0] * w;' };
const channels = new Map([
  ['y', sum],
  ['z', sum],
  ['v', sum],
]);
const runnerOf = (patch: object): Runner => {
  const p = packOf(patch, channels);
  if (p === undefined || !('runner' in p)) throw new Error('no runner');
  return p.runner;
};
const stub: Runner = { key: 'stub', helpers: '', wgsl: 'out.v = 1.0;', writes: ['v'], fields: [] };

describe('kernel', () => {
  const k = kernel([runnerOf(a), runnerOf(b)], channels, 100);
  it('holds a function and a switch arm per runner', () => {
    expect(k.code).toContain('fn run_0(');
    expect(k.code).toContain('fn run_1(');
    expect(k.code.match(/case 1u/g)).toHaveLength(2);
  });
  it('runs a shader patch beside another kind of runner', () => {
    const mixed = kernel([runnerOf(a), stub], channels, 100);
    expect(mixed.code).toContain('fn run_0(');
    expect(mixed.code).toContain('fn run_1(');
    expect(mixed.code).toContain('case 1u');
    expect(mixed.code).toContain('out.o_v = 1.0;');
  });
  it('gives the same code for the same runner keys', () => {
    const again = kernel([runnerOf(a), stub], channels, 100);
    expect(again.code).toBe(kernel([runnerOf(a), stub], channels, 100).code);
  });
  it('gives every runner the lag of the subject it runs for', () => {
    expect(k.code).toContain(
      'fn run_0(phase: f32, pass_index: f32, subject: Subject, base: u32, sub: u32, lag: f32) -> Out_0',
    );
    expect(k.code).toContain('fn blits_take(o: u32, i: u32) -> Take');
    expect(k.code.match(/blits_take\(o, i\)/g)).toHaveLength(2);
  });
  it("picks each role's leader per subject, reading none from the row", () => {
    expect(k.code).toContain('lead[r] = k;');
    expect(k.code).toContain('if (lead[r] == k)');
    expect(k.code).not.toMatch(/table\[o \+ \d+u\] == 1\.0/);
  });
  it('gives the same code for two frames whose voices differ only in data', () => {
    const near = spring<{ id: number }, O>('y', { to: (c) => c.id });
    const far = spring<{ id: number }, O>('y', { to: (c) => 10 * c.id, stiffness: 400 });
    expect(runnerOf(near).wgsl).toContain('let t = values[k] - lag;');
    expect(kernel([runnerOf(near), stub], channels, 100).code).toBe(
      kernel([runnerOf(far), stub], channels, 100).code,
    );
  });
  it('includes a shared helper once', () => {
    expect(k.code.split(helper)).toHaveLength(2);
  });
  it('lays the channels end to end, a subject at a time', () => {
    expect(k.outputs).toEqual([
      { name: 'y', axes: 1, offset: 0 },
      { name: 'z', axes: 1, offset: 100 },
      { name: 'v', axes: 1, offset: 200 },
    ]);
    expect(k.size).toBe(300);
  });
  it('gives every subject the union of the fields, sorted', () => {
    expect(k.fields).toEqual(['w', 'x']);
  });
  it('reads parameters from the values buffer at the voice offset', () => {
    expect(k.code).toContain('let params_k = values[base + 0u];');
  });
  it('binds the per-subject buffer', () => {
    expect(k.code).toContain('@group(0) @binding(5) var<storage, read> persub: array<f32>;');
  });
  it('prefixes the names an author wrote, so a reserved word such as cast is fine', () => {
    expect(prefixed('out.cast = subject.loop * params.var; let out2 = 1.0;')).toBe(
      'out.o_cast = subject.s_loop * params_var; let out2 = 1.0;',
    );
    expect(k.code).toContain('struct Subject { s_w: f32, s_x: f32, }');
  });
});

describe('packOf', () => {
  it('packs a shader patch once, with its parameters in order', () => {
    const p = b.with({ k: 3 });
    const once = packOf(p, channels);
    expect(once).toBe(packOf(p, channels));
    expect(once !== undefined && 'values' in once ? [...once.values] : []).toEqual([3]);
  });
  it('gives patches made with with one runner', () => {
    expect(runnerOf(b.with({ k: 1 }))).toBe(runnerOf(b.with({ k: 2 })));
    expect(runnerOf(a).key).not.toBe(runnerOf(b).key);
  });
  it('claims no plain patch', () => {
    expect(packOf({ form: 'fn' }, channels)).toBeUndefined();
  });
});
