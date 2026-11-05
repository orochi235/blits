import { describe, expect, it, vi } from 'vitest';
import { gpu, gpuOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { kit, mix, sum } from '../src/index.js';
import { fakeDevice } from './gpu-device.js';

interface C {
  a: number;
  b: number;
  c: number;
}
interface P {
  y: number;
}

/** A gpu mix over `n` subjects on a device binding at most `limit` bytes of storage. */
async function bound(n: number, limit: number, cue: boolean) {
  const d = fakeDevice();
  Object.assign(d.device, { limits: { maxStorageBufferBindingSize: limit } });
  const dispatched = () => d.log.filter((l) => l === 'dispatch').length;
  const cells = Array.from({ length: n }, (_, i) => ({ a: i, b: i, c: i }));
  const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
  m.sync(0);
  if (cue)
    m.cue({
      patch: shaderPatch<C, P>(1000, {
        wgsl: 'out.y = subject.a + subject.b + subject.c;',
        at: (_, s) => ({ y: s.a + s.b + s.c }),
        writes: ['y'],
        fields: { a: 'f32', b: 'f32', c: 'f32' },
      }),
      loop: true,
    });
  const side = gpuOf(m);
  side.subjects(cells, (s) => ({ ...s }));
  side.channel('y');
  await side.ready;
  m.sync(16);
  return { side, dispatched };
}

describe('gpu binding limits', () => {
  it('keeps the fold on the CPU where the output buffer would pass the largest the device binds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { side, dispatched } = await bound(8, 16, false);
    expect(side.channel('y')).toBeNull();
    expect(dispatched()).toBe(0);
    expect(side.reasons()).toEqual([
      {
        voice: undefined,
        channels: ['y'],
        why: 'its channels would take the output buffer past the largest the device binds, so every channel stays on the CPU',
      },
    ]);
    warn.mockRestore();
  });

  it("keeps the fold on the CPU where the subjects' fields would pass the largest the device binds", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { side, dispatched } = await bound(4, 32, true);
    expect(side.channel('y')).toBeNull();
    expect(dispatched()).toBe(0);
    expect(side.reasons().map((r) => r.why)).toEqual([
      "the subjects' fields would take the subjects buffer past the largest the device binds, so every channel stays on the CPU",
    ]);
    warn.mockRestore();
  });

  it('folds where every buffer fits', async () => {
    const { side, dispatched } = await bound(4, 1024, true);
    expect(side.channel('y')).not.toBeNull();
    expect(dispatched()).toBe(1);
  });
});
