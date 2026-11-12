import { describe, expect, it } from 'vitest';
import { Col, ROW } from '../src/gpu/columns.js';
import { gpu, gpuOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { kit, mix, spring, sum } from '../src/index.js';
import { fakeDevice } from './gpu-device.js';

interface C {
  x: number;
}
interface P {
  y: number;
}
const cells: C[] = [{ x: 0 }, { x: 1 }];

/** A gpu mix folding a spring on a compiled kernel, its device holding every later compile. */
async function compiled() {
  const d = fakeDevice({ compile: 'held' });
  const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
  m.sync(0);
  m.cue({ patch: spring<C, P>('y', { to: (c) => c.x }), subjects: cells });
  const side = gpuOf(m);
  side.subjects(cells, () => ({}));
  side.channel('y');
  d.compiled();
  await side.ready;
  m.sync(16);
  expect(side.channel('y')).not.toBeNull();
  return { d, m, side };
}

const runnerOf = (table: Float32Array, k: number) => table[k * ROW + Col.SHADER];

describe('gpu stand-in kernel', () => {
  it('folds a shader patch it lacks from its at while the new kernel compiles, flagging where at gives nothing', async () => {
    const { d, m, side } = await compiled();
    const wave = shaderPatch<C, P>(1000, {
      wgsl: 'out.y = phase;',
      at: (phase, c) => (c.x > 0 ? {} : { y: phase }),
      writes: ['y'],
    });
    m.cue({ patch: wave, subjects: cells, loop: true });
    m.sync(266);
    expect(side.channel('y')).not.toBeNull();
    expect(runnerOf(d.written('table') as Float32Array, 1)).toBe(0);
    expect(Array.from(d.written('persub') as Float32Array)).toEqual([1, 0.25, 0, 0]);
    d.compiled();
    await side.ready;
    m.sync(282);
    expect(side.channel('y')).not.toBeNull();
    expect(runnerOf(d.written('table') as Float32Array, 1)).not.toBe(0);
  });

  it('stands in with a kernel that compiled but never folded', async () => {
    const d = fakeDevice({ compile: 'held' });
    const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
    m.sync(0);
    m.cue({ patch: spring<C, P>('y', { to: (c) => c.x }), subjects: cells });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    side.channel('y');
    d.compiled();
    await side.ready;
    const wave = shaderPatch<C, P>(1000, {
      wgsl: 'out.y = phase;',
      at: (phase) => ({ y: phase }),
      writes: ['y'],
    });
    m.cue({ patch: wave, subjects: cells, loop: true });
    m.sync(16);
    expect(side.channel('y')).not.toBeNull();
  });

  it('waits where the new voice staggers', async () => {
    const { m, side } = await compiled();
    const wave = shaderPatch<C, P>(1000, {
      wgsl: 'out.y = phase;',
      at: (phase) => ({ y: phase }),
      writes: ['y'],
    });
    m.cue({ patch: wave, subjects: cells, loop: true, stagger: (c) => c.x * 100 });
    m.sync(266);
    expect(side.channel('y')).toBeNull();
    expect(side.reasons()).toEqual([]);
  });
});
