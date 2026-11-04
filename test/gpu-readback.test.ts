import { afterEach, describe, expect, it, vi } from 'vitest';
import { gpu, gpuOf } from '../src/gpu/engine.js';
import { MAX_ROLES } from '../src/gpu/kernel.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { kit, level, mix, patch, slew, spring, sum } from '../src/index.js';
import { fakeDevice } from './gpu-device.js';

interface C {
  x: number;
}
interface P {
  y: number;
  z: number;
}
const wave = shaderPatch<C, P>(1000, {
  wgsl: 'out.y = phase;',
  at: (phase, c) => ({ y: phase + c.x }),
  writes: ['y'],
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A gpu mix playing `wave` over three cells, its kernel compiled, each fold writing its serial. */
async function folding(opts: { compile?: 'held' } = {}) {
  const fake = fakeDevice(opts);
  fake.onDispatch((out, serial) => out.fill(serial));
  const cells = [{ x: 0 }, { x: 1 }, { x: 2 }];
  const m = mix<C, P>(kit<P>({ y: sum(), z: sum() }), { engine: gpu({ device: fake.device }) });
  m.sync(0);
  const h = m.cue({ patch: wave, subjects: cells, loop: true });
  const side = gpuOf(m);
  side.subjects(cells, () => ({}));
  expect(await side.read('y')).toBeNull();
  if (opts.compile !== 'held') await side.ready;
  const dispatched = () => fake.log.filter((l) => l === 'dispatch').length;
  return { fake, m, h, side, cells, dispatched };
}

const every = (values: Float32Array, v: number) => Array.from(values).every((x) => x === v);

describe('gpu read', () => {
  it('resolves null wherever channel() is null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeDevice();
    const m = mix<C, P>(kit<P>({ y: sum(), z: sum() }), { engine: gpu({ device: fake.device }) });
    m.sync(0);
    m.cue({ patch: wave, subjects: [{ x: 0 }], loop: true });
    expect(await gpuOf(m).read('y')).toBeNull();

    const f = await folding();
    f.m.cue({ patch: patch<C, P>(0, () => ({ z: 1 }), { writes: ['z'] }), subjects: f.cells });
    await f.side.read('z');
    await f.side.ready;
    expect(f.side.channel('z')).toBeNull();
    expect(await f.side.read('z')).toBeNull();
    const y = f.side.read('y');
    await f.fake.settle();
    expect(await y).not.toBeNull();

    const held = await folding({ compile: 'held' });
    held.m.sync(16);
    expect(held.side.channel('y')).toBeNull();
    expect(await held.side.read('y')).toBeNull();

    const closed = await folding();
    closed.m.close();
    expect(await closed.side.read('y')).toBeNull();

    const lost = await folding();
    lost.fake.lose();
    await lost.fake.device.lost;
    expect(await lost.side.read('y')).toBeNull();
  });

  it('a read alone folds again after each kind of change', async () => {
    const fake = fakeDevice();
    const cells = [{ x: 0 }, { x: 1 }];
    const m = mix<C, P>(kit<P>({ y: sum(), z: sum() }), { engine: gpu({ device: fake.device }) });
    m.sync(0);
    const lvl = level<C>(0.5);
    m.cue({ patch: wave, subjects: cells, loop: true, weight: lvl });
    const s = spring<C, P>('z', { to: (c) => c.x });
    m.cue({ patch: s, subjects: cells });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    await side.read('y');
    await side.ready;
    const dispatched = () => fake.log.filter((l) => l === 'dispatch').length;
    // The spring's first fold sets up its mirror, which folds once more.
    void side.read('y');
    void side.read('y');
    const base = dispatched();
    void side.read('y');
    expect(dispatched()).toBe(base);
    m.sync(16);
    void side.read('y');
    expect(dispatched()).toBe(base + 1);
    m.cue({ patch: wave, subjects: cells, loop: true });
    void side.read('y');
    expect(dispatched()).toBe(base + 2);
    lvl.set(0.25);
    void side.read('y');
    expect(dispatched()).toBe(base + 3);
    s.to(cells[0] as C, 5);
    void side.read('y');
    expect(dispatched()).toBe(base + 4);
    void side.read('y');
    expect(dispatched()).toBe(base + 4);
  });

  it("copies the previous frame's last fold before the new frame writes anything", async () => {
    const { fake, m, side, cells } = await folding();
    m.sync(50);
    void side.read('y');
    m.cue({ patch: wave, subjects: cells, loop: true });
    void side.read('y');
    expect(fake.log.filter((l) => l === 'dispatch')).toHaveLength(2);
    m.sync(66);
    const from = fake.log.length;
    const read = side.read('y');
    const log = fake.log.slice(from);
    const copy = log.findIndex((l) => l.startsWith('copy out->readback'));
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(copy).toBeLessThan(log.indexOf('write table'));
    expect(copy).toBeLessThan(log.indexOf('dispatch'));
    await fake.settle();
    const r = await read;
    expect(r).not.toBeNull();
    expect(every(r?.values as Float32Array, 2)).toBe(true);
    expect(r?.values).toHaveLength(3);
    expect(r?.timestamp).toBe(50);
  });

  it('gives the same read again with no sync between', async () => {
    const { fake, m, side } = await folding();
    m.sync(16);
    void side.read('y');
    await fake.settle();
    m.sync(32);
    const a = side.read('y');
    const b = side.read('y');
    await fake.settle();
    const [ra, rb] = [await a, await b];
    expect(ra).not.toBeNull();
    expect(ra).toBe(rb);
    expect(ra?.timestamp).toBe(16);
  });

  it('a control change starts a frame', async () => {
    const { fake, m, h, side } = await folding();
    m.sync(100);
    const first = side.read('y');
    await fake.settle();
    const before = await first;
    const serial = before?.values[0] as number;
    h.rate = 2;
    const after = side.read('y');
    expect(fake.log.filter((l) => l === 'dispatch')).toHaveLength(serial + 1);
    await fake.settle();
    const r = await after;
    expect(r?.now).toBe(100);
    expect(every(r?.values as Float32Array, serial)).toBe(true);
  });

  it('reads now and then', async () => {
    const { fake, m, side } = await folding();
    const serials: number[] = [];
    fake.onDispatch((_, serial) => serials.push(serial));
    const read = async () => {
      const r = side.read('y');
      await fake.settle();
      return (await r)?.values[0];
    };
    m.sync(16);
    expect(await read()).toBe(serials[0]);
    m.sync(32);
    expect(await read()).toBe(serials[0]);
    m.sync(48);
    side.channel('y');
    const third = serials[2];
    m.sync(64);
    expect(await read()).toBe(third);
    // Read in frame 4, so frame 5 gives frame 4's fold though channel() folds it first.
    const fourth = serials[3];
    m.sync(80);
    side.channel('y');
    expect(await read()).toBe(fourth);
  });

  it('subjects() between a fold and its read resolving', async () => {
    const { fake, m, side, cells } = await folding();
    m.sync(16);
    const waiting = side.read('y');
    const reversed = cells.slice().reverse();
    side.subjects(reversed, () => ({}));
    await fake.settle();
    const old = await waiting;
    expect(old?.subjects).toEqual(cells);
    expect(old?.subjects).not.toBe(cells);
    expect(Object.isFrozen(old?.subjects)).toBe(true);
    expect(every(old?.values as Float32Array, 1)).toBe(true);
    const next = side.read('y');
    await fake.settle();
    const r = await next;
    expect(r?.subjects).toEqual(reversed);
    expect(every(r?.values as Float32Array, 2)).toBe(true);
  });

  it('close() destroys the staging buffers; device loss destroys nothing', async () => {
    const closed = await folding();
    closed.m.sync(16);
    const a = closed.side.read('y');
    closed.m.close();
    expect(closed.fake.destroyed).toContain('readback');
    expect(await a).toBeNull();

    const lost = await folding();
    lost.m.sync(16);
    const b = lost.side.read('y');
    lost.fake.lose();
    await lost.fake.device.lost;
    expect(await b).toBeNull();
    expect(lost.fake.destroyed).toEqual([]);
  });

  it('copies from the output buffer a fold used, across a kernel that grows it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeDevice();
    const serials: number[] = [];
    fake.onDispatch((out, serial) => {
      out.fill(serial);
      serials.push(serial);
    });
    // 17 cells: `out` holds y alone in 128 bytes, and needs 256 once z folds too.
    const cells = Array.from({ length: 17 }, (_, x) => ({ x }));
    const m = mix<C, P>(kit<P>({ y: sum(), z: sum() }), { engine: gpu({ device: fake.device }) });
    m.sync(0);
    m.cue({ patch: wave, subjects: cells, loop: true });
    const cpu = m.cue({ patch: patch<C, P>(0, () => ({ z: 1 }), { writes: ['z'] }), loop: true });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    await side.read('y');
    await side.ready;
    const read = async (name: string) => {
      const r = side.read(name);
      await fake.settle();
      return (await r)?.values;
    };
    m.sync(16);
    await read('y');
    m.sync(32);
    await read('y');
    const second = serials[1] as number;
    m.sync(48);
    cpu.weight = 0;
    // The turn copies frame 2's fold out of `out`; the new kernel then compiles.
    expect(await side.read('y')).toBeNull();
    await side.ready;
    const grown = side.read('y');
    expect(fake.destroyed).toContain('out');
    await fake.settle();
    expect(every((await grown)?.values as Float32Array, second)).toBe(true);
    const third = serials[2] as number;
    m.sync(64);
    const y = side.read('y');
    const z = side.read('z');
    await fake.settle();
    expect(every((await y)?.values as Float32Array, third)).toBe(true);
    expect(every((await z)?.values as Float32Array, third + 1)).toBe(true);
  });

  it('reasons() names each voice left on the CPU and why, in production too, without folding', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { m, side, cells, dispatched } = await folding();
    void side.read('y');
    expect(side.reasons()).toEqual([]);
    m.cue({
      patch: wave,
      subjects: cells,
      loop: true,
      name: 'drift',
      weight: slew((c) => c.x, { riseMs: 100 }),
    });
    const before = dispatched();
    expect(side.reasons()).toEqual([]);
    expect(await side.read('y')).toBeNull();
    const reasons = [
      {
        voice: 'drift',
        channels: ['y'],
        why: "its weight signal keeps state for each subject, which only the CPU's records hold",
      },
    ];
    expect(side.reasons()).toEqual(reasons);
    expect(side.reasons()).toEqual(reasons);
    expect(dispatched()).toBe(before);
    expect(warn).not.toHaveBeenCalled();
  });

  /** `folding()` with a second voice, `drift`, that the next fold leaves on the CPU. */
  async function drifting() {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await folding();
    const weight = slew((c: C) => c.x, { riseMs: 100 });
    f.m.cue({ patch: wave, subjects: f.cells, loop: true, name: 'drift', weight });
    expect(await f.side.read('y')).toBeNull();
    expect(f.side.reasons()).toHaveLength(1);
    return f;
  }

  it('reasons() empties at subjects()', async () => {
    const { side, cells } = await drifting();
    side.subjects(cells, () => ({}));
    expect(side.reasons()).toEqual([]);
  });

  it('reasons() empties at close()', async () => {
    const { m, side } = await drifting();
    m.close();
    expect(side.reasons()).toEqual([]);
  });

  it('reasons() empties at device loss', async () => {
    const { fake, side } = await drifting();
    fake.lose();
    await fake.device.lost;
    expect(side.reasons()).toEqual([]);
  });

  it('reasons() is frozen, entries and channels too', async () => {
    const { side } = await drifting();
    const reasons = side.reasons();
    expect(Object.isFrozen(reasons)).toBe(true);
    for (const r of reasons) {
      expect(Object.isFrozen(r)).toBe(true);
      expect(Object.isFrozen(r.channels)).toBe(true);
    }
  });

  it('reasons() says why when a frame has more roles than the gpu engine folds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { m, side, cells } = await folding();
    for (let r = 0; r <= MAX_ROLES; r++)
      m.cue({ patch: wave, subjects: cells, loop: true, role: `r${r}` });
    side.channel('y');
    await side.ready;
    m.sync(16);
    expect(side.channel('y')).toBeNull();
    expect(side.reasons()).toEqual([
      {
        voice: undefined,
        channels: ['y', 'z'],
        why: `the gpu engine folds at most ${MAX_ROLES} roles a frame, so in a frame with more every channel stays on the CPU`,
      },
    ]);
  });
});
