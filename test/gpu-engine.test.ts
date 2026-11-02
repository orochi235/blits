import { describe, expect, it } from 'vitest';
import { gpu, gpuOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import type { GpuDevice } from '../src/gpu/webgpu.js';
import { kit, mix, sum } from '../src/index.js';

interface C {
  x: number;
}
interface P {
  y: number;
}
const wave = shaderPatch<C, P>(1000, {
  wgsl: 'out.y = phase;',
  at: (phase, c) => ({ y: phase + c.x }),
  writes: ['y'],
});
/** A device whose every call throws: a mix that never asks for a channel must not touch it. */
const untouched = new Proxy(
  { lost: new Promise(() => {}) },
  {
    get(target, key) {
      if (key === 'lost') return target.lost;
      if (key === 'then') return undefined;
      throw new Error(`the device was asked for ${String(key)}`);
    },
  },
) as unknown as GpuDevice;

describe('gpu engine', () => {
  it('plays on the CPU as mixer does while nothing asks for a channel', () => {
    const cells = [{ x: 0 }, { x: 1 }];
    const g = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: untouched }) });
    const c = mix<C, P>(kit<P>({ y: sum() }));
    for (const m of [g, c]) {
      m.sync(0);
      m.cue({ patch: wave, subjects: cells, loop: true });
      m.sync(250);
    }
    for (const s of cells) expect(g.probe(s).y).toBe(c.probe(s).y);
  });

  it('gives no channel before any subject is registered', () => {
    const g = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: untouched }) });
    g.sync(0);
    expect(gpuOf(g).channel('y')).toBeNull();
  });

  it('refuses gpuOf for a mix another engine made', () => {
    expect(() => gpuOf(mix<C, P>(kit<P>({ y: sum() })))).toThrow(/gpu engine/);
  });
});
