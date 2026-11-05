import { describe, expect, it, vi } from 'vitest';
import { Col } from '../src/gpu/columns.js';
import { gpu, gpuOf, mixerOf } from '../src/gpu/engine.js';
import { MAX_ROLES } from '../src/gpu/kernel.js';
import { Reasons } from '../src/gpu/reasons.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import type { GpuDevice } from '../src/gpu/webgpu.js';
import { kit, level, mix, slew, spring, sum } from '../src/index.js';
import { motionOf } from '../src/motion.js';
import { fakeDevice } from './gpu-device.js';

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

/** The fake device, read as these tests count dispatches and the last data written to a buffer. */
function stub() {
  const d = fakeDevice();
  const dispatched = () => d.log.filter((l) => l === 'dispatch').length;
  return { device: d.device, destroyed: d.destroyed, lose: d.lose, dispatched, write: d.written };
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
    expect(mixerOf(m).unheld).toBeNull();
    expect(mixerOf(m).unmet).toBeNull();
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
    expect(mixerOf(m).unheld).toBeNull();
    expect(mixerOf(m).unmet).toBeNull();
  });

  it('drops a twin check whose map a lost device refuses, rejecting nothing unhandled', async () => {
    const d = fakeDevice();
    const seen: unknown[] = [];
    const hear = (e: unknown) => seen.push(e);
    process.on('unhandledRejection', hear);
    try {
      // The first fold of a runner maps a sample back to check against the CPU.
      await folding(d.device);
      expect(d.log).toContain('map twins');
      d.refuse();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      process.off('unhandledRejection', hear);
    }
    expect(seen).toEqual([]);
  });

  it("times a change as the CPU's record would, once a fold has met the voice", async () => {
    const d = stub();
    const cells = Array.from({ length: 4 }, (_, x) => ({ x }));
    const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
    m.sync(0);
    const s = spring<C, P>('y', { to: (c) => c.x });
    // Weight 0 under its owner, so no read commits a change and only its stamp shows.
    const owner = m.owns({ weight: 0 });
    const named = [cells[0], cells[1], cells[3]] as C[];
    m.cue({ patch: s, owner, subjects: named, stagger: (c) => c.x * 100 });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    const at = (c: C) => {
      const motions = motionOf<C>(s);
      const list = motions?.pending?.[motions.known(c) as number];
      return list?.[0]?.at;
    };
    // No fold has met it, as no probe has on the CPU.
    s.to(cells[0] as C, 5);
    expect(at(cells[0] as C)).toBeUndefined();
    side.channel('y');
    await side.ready;
    m.sync(150);
    side.channel('y');
    for (const c of cells) s.to(c, 5);
    expect(cells.map(at)).toEqual([150, 50, undefined, undefined]);
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
    expect(d.write('table')?.[Col.WEIGHT]).toBe(0.25);
    side.channel('y');
    expect(d.dispatched()).toBe(2);
  });

  it("writes each subject's weight read after the other per-subject data", async () => {
    const d = stub();
    const cells = [{ x: 0 }, { x: 1 }];
    const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
    m.sync(0);
    m.cue({ patch: wave, subjects: cells, loop: true, weight: (c) => c.x + 0.5 });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    side.channel('y');
    await side.ready;
    m.sync(16);
    expect(side.channel('y')).not.toBeNull();
    expect(Array.from(d.write('persub') ?? [])).toEqual([0.5, 1.5]);
    expect(new Uint32Array((d.write('table') as Float32Array).buffer)[Col.WEIGHTS]).toBe(0);
  });

  it('marks no voice met in a frame with more roles than it folds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = stub();
    const cells = [{ x: 0 }, { x: 1 }];
    const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
    m.sync(0);
    for (let r = 0; r <= MAX_ROLES; r++)
      m.cue({ patch: wave, subjects: cells, loop: true, role: `r${r}` });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    side.channel('y');
    await side.ready;
    m.sync(16);
    expect(side.channel('y')).toBeNull();
    expect(d.dispatched()).toBe(0);
    const mixer = mixerOf(m);
    const unheld = mixer.unheld as NonNullable<typeof mixer.unheld>;
    for (const v of mixer.cued) expect(unheld(v, cells[0] as C)).toBeUndefined();
    warn.mockRestore();
  });

  it('keeps a voice weighted by a slew on the CPU from its first frame, unprobed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = stub();
    const cells = [{ x: 0 }, { x: 1 }];
    const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
    m.sync(0);
    m.cue({ patch: wave, subjects: cells, loop: true, weight: slew((c) => c.x, { riseMs: 100 }) });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    expect(side.channel('y')).toBeNull();
    await side.ready;
    m.sync(16);
    expect(side.channel('y')).toBeNull();
    expect(d.dispatched()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "blits: y: its weight signal keeps state for each subject, which only the CPU's records hold, so the gpu engine leaves it on the CPU",
    );
    warn.mockRestore();
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

  it('waits on a compiling kernel without starting the fold again at each call', async () => {
    const d = fakeDevice({ compile: 'held' });
    const cells = [{ x: 0 }, { x: 1 }];
    const m = mix<C, P>(kit<P>({ y: sum() }), { engine: gpu({ device: d.device }) });
    m.sync(0);
    const s = spring<C, P>('y', { to: (c) => c.x });
    m.cue({ patch: s, subjects: cells });
    const side = gpuOf(m);
    side.subjects(cells, () => ({}));
    side.channel('y');
    d.compiled();
    await side.ready;
    m.sync(16);
    expect(side.channel('y')).not.toBeNull();
    m.cue({ patch: wave, subjects: cells, loop: true });
    expect(side.channel('y')).toBeNull();
    s.to(cells[0] as C, 5);
    const note = vi.spyOn(Reasons.prototype, 'note');
    side.channel('y');
    side.channel('y');
    side.channel('y');
    expect(note.mock.calls.length).toBeLessThanOrEqual(1);
    note.mockRestore();
    d.compiled();
    await side.ready;
    expect(side.channel('y')).not.toBeNull();
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
