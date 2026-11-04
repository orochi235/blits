import { describe, expect, it } from 'vitest';
import { gpu, gpuOf, mixerOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import type { GpuBuffer, GpuDevice } from '../src/gpu/webgpu.js';
import { kit, level, mix, spring, sum } from '../src/index.js';
import { motionOf } from '../src/motion.js';

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

/** A device that does nothing, keeping the label of each buffer the gpu side destroys. */
function stub() {
  const destroyed: string[] = [];
  let dispatched = 0;
  let lose = () => {};
  const lost = new Promise<void>((resolve) => {
    lose = resolve;
  });
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups() {
      dispatched++;
    },
    end() {},
  };
  const device = {
    queue: { writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {} },
    lost,
    createBuffer(desc: { size: number; label?: string }): GpuBuffer {
      return {
        size: desc.size,
        mapAsync: () => new Promise(() => {}),
        getMappedRange: () => new ArrayBuffer(desc.size),
        unmap() {},
        destroy() {
          if (desc.label?.startsWith('blits gpu ')) destroyed.push(desc.label.slice(10));
        },
      };
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginComputePass: () => pass,
      copyBufferToBuffer() {},
      finish: () => ({}),
    }),
  } as unknown as GpuDevice;
  return { device, destroyed, lose: () => lose(), dispatched: () => dispatched };
}

/** A gpu mix folding a staggered spring that fades in, so the side has a mirror and a timing block. */
async function folding(device: GpuDevice) {
  const cells = Array.from({ length: 8 }, (_, x) => ({ x }));
  const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device }) });
  m.sync(0);
  const s = spring<C, P>('y', { to: (c) => c.x });
  const h = m.cue({ patch: s, subjects: cells, stagger: (c) => c.x * 100, fade: { in: 300 } });
  const side = gpuOf(m);
  side.subjects(cells, () => ({}));
  side.channel('y');
  await side.ready;
  m.sync(16);
  expect(side.channel('y')).not.toBeNull();
  const motions = motionOf<C>(s);
  expect(motions?.listener).not.toBeNull();
  expect(mixerOf(m).reorigined).not.toBeNull();
  return { m, s, h, side, cells, motions };
}

describe('gpu engine', () => {
  it('destroys its buffers and lets go of the patch and the clock on close', async () => {
    const d = stub();
    const { m, s, h, side, cells, motions } = await folding(d.device);
    m.close();
    expect(d.destroyed.sort()).toEqual(['frame', 'out', 'persub', 'subjects', 'table', 'values']);
    expect(side.channel('y')).toBeNull();
    expect(() => gpuOf(m)).toThrow(/gpu engine/);
    // Nothing of the side hears the patch or the clock now.
    expect(motions?.listener).toBeNull();
    s.to(cells[1] as C, 5);
    expect(mixerOf(m).reorigined).toBeNull();
    h.rate = 2;
    expect(mixerOf(m).reorigined).toBeNull();
  });

  it('lets go of the patch and the clock, and destroys nothing, when the device is lost', async () => {
    const d = stub();
    const { m, side, motions } = await folding(d.device);
    d.lose();
    await d.device.lost;
    await expect(side.ready).rejects.toThrow(/device was lost/);
    expect(d.destroyed).toEqual([]);
    expect(side.channel('y')).toBeNull();
    expect(motions?.listener).toBeNull();
    expect(mixerOf(m).reorigined).toBeNull();
  });

  it('folds again after a level is set between syncs', async () => {
    const d = stub();
    const cells = [{ x: 0 }, { x: 1 }];
    const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
    m.sync(0);
    const lvl = level<C>(0.5);
    m.cue({ patch: wave, subjects: cells, loop: true, weight: lvl });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    side.channel('y');
    await side.ready;
    side.channel('y');
    side.channel('y');
    expect(d.dispatched()).toBe(1);
    lvl.set(0.25);
    side.channel('y');
    expect(d.dispatched()).toBe(2);
    side.channel('y');
    expect(d.dispatched()).toBe(2);
  });

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
