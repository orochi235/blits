import { afterEach, describe, expect, it, vi } from 'vitest';
import { gpu, gpuOf } from '../src/gpu/engine.js';
import type { GpuBuffer } from '../src/gpu/webgpu.js';
import { kit, mix, spring, sum } from '../src/index.js';
import { fakeDevice } from './gpu-device.js';

interface C {
  x: number;
}
interface P {
  y: number;
}

/** A gpu mix folding a spring on four cells, its first fold made at 16 and checked against the CPU. */
async function first() {
  const d = fakeDevice();
  const made: GpuBuffer[] = [];
  const create = d.device.createBuffer.bind(d.device);
  d.device.createBuffer = (desc) => {
    const b = create(desc);
    if (desc.label === 'blits gpu twins') made.push(b);
    return b;
  };
  const dispatched = () => d.log.filter((l) => l === 'dispatch').length;
  const cells = Array.from({ length: 4 }, (_, x) => ({ x }));
  const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
  m.sync(0);
  m.cue({ patch: spring<C, P>('y', { to: (c) => c.x }), subjects: cells });
  const side = gpuOf(m);
  side.subjects(cells, () => ({}));
  side.channel('y');
  await side.ready;
  m.sync(16);
  side.channel('y');
  return { d, side, dispatched, twin: made[0] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('twin checks', () => {
  it("leave a spring's first fold standing for the rest of its frame", async () => {
    const { side, dispatched } = await first();
    expect(dispatched()).toBe(1);
    side.channel('y');
    expect(dispatched()).toBe(1);
  });

  it('destroy the staging buffer of a map the device refuses', async () => {
    const { d } = await first();
    d.refuse();
    await new Promise((r) => setTimeout(r, 0));
    expect(d.destroyed).toContain('twins');
  });

  it('report a check that throws once its map settles, rejecting nothing unhandled', async () => {
    const seen: unknown[] = [];
    const hear = (e: unknown) => seen.push(e);
    process.on('unhandledRejection', hear);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { d, twin } = await first();
      if (twin === undefined) throw new Error('no twin check was made');
      twin.getMappedRange = () => {
        throw new Error('the range is gone');
      };
      await d.settle();
      await new Promise((r) => setTimeout(r, 0));
      expect(d.destroyed).toContain('twins');
    } finally {
      process.off('unhandledRejection', hear);
    }
    expect(seen).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/twin check .*the range is gone/));
  });
});
