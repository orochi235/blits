import { describe, expect, it } from 'vitest';
import { type Fold, type GpuRead, Readback } from '../src/gpu/readback.js';
import type { GpuChannel } from '../src/gpu/side.js';
import { Usage } from '../src/gpu/webgpu.js';
import { fakeDevice } from './gpu-device.js';

const n = 4;
const abcd = ['a', 'b', 'c', 'd'];

function ring() {
  const d = fakeDevice();
  const r = new Readback<string>(d.device);
  const out = d.device.createBuffer({
    size: n * 4 * 4,
    usage: Usage.STORAGE | Usage.COPY_SRC,
    label: 'blits gpu out',
  });
  const outputs = new Map<string, GpuChannel>([
    ['s', { buffer: out, offset: 0, stride: 4, axes: 1 }],
    ['p', { buffer: out, offset: n * 4, stride: 12, axes: 3 }],
  ]);
  /** A fold at `frame`, with `seq` the frame too, as a host syncing every frame makes them. */
  const fold = (frame: number, list: readonly string[] = abcd): Fold<string> => ({
    out,
    outputs,
    frame,
    seq: frame,
    now: frame * 16,
    timestamp: 1000 + frame,
    list,
  });
  const fill = (base: number) =>
    d.fill(out, (a) => {
      for (let j = 0; j < a.length; j++) a[j] = base + j;
    });
  const read = (name: string, frame: number) => r.read(name, frame, frame);
  return { d, r, out, fold, fill, read };
}

const copies = (log: string[]) => log.filter((l) => l.startsWith('copy'));

describe('gpu readback ring', () => {
  it('copies the wanted channels of the last fold into one staging buffer, then maps it', async () => {
    const { d, r, fold, fill, read } = ring();
    fill(0);
    const f1 = fold(1);
    r.want('s');
    r.fold(f1);
    r.turn(2);
    expect(d.log).toEqual(['copy out->readback 0+16', 'submit', 'map readback']);
    await d.settle();
    const got = (await read('s', 2)) as GpuRead<string>;
    expect(Array.from(got.values)).toEqual([0, 1, 2, 3]);
    expect(got.axes).toBe(1);
    expect(got.now).toBe(f1.now);
    expect(got.timestamp).toBe(f1.timestamp);
    expect(got.subjects).toEqual(abcd);
  });

  it('copies nothing when nothing was read, the fold is this frame’s, or it was copied already', () => {
    const { d, r, fold } = ring();
    r.fold(fold(1));
    r.turn(2);
    expect(copies(d.log)).toEqual([]);
    r.want('s');
    r.fold(fold(2));
    r.turn(2);
    expect(copies(d.log)).toEqual([]);
    r.turn(3);
    expect(copies(d.log)).toHaveLength(1);
    r.want('s');
    r.turn(3);
    expect(copies(d.log)).toHaveLength(1);
  });

  it('copies only wanted channels the fold holds, and throws on a channel laid out otherwise', () => {
    const { d, r, out, fold } = ring();
    r.want('q');
    r.fold(fold(1));
    r.turn(2);
    expect(copies(d.log)).toEqual([]);
    const wide = new Map<string, GpuChannel>([
      ['w', { buffer: out, offset: 0, stride: 16, axes: 3 }],
    ]);
    r.want('w');
    r.fold({ ...fold(2), outputs: wide });
    expect(() => r.turn(3)).toThrow(/stride/);
  });

  it('lays a multi-axis channel out subject by subject', async () => {
    const { d, r, fold, fill, read } = ring();
    fill(0);
    r.want('p');
    r.fold(fold(1));
    r.turn(2);
    await d.settle();
    const got = (await read('p', 2)) as GpuRead<string>;
    expect(Array.from(got.values)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(got.axes).toBe(3);
  });

  it('gives the same read to every call in a frame', async () => {
    const { d, r, fold, read } = ring();
    r.want('s');
    r.fold(fold(1));
    r.turn(2);
    const first = read('s', 2);
    const second = read('s', 2);
    await d.settle();
    const got = await first;
    expect(got).not.toBeNull();
    expect(await second).toBe(got);
  });

  it('copies the current fold for a channel the turn did not copy', async () => {
    const { d, r, fold, read } = ring();
    const f2 = fold(2);
    r.fold(f2);
    const pending = read('s', 2);
    expect(d.log).toEqual(['copy out->readback 0+16', 'submit', 'map readback']);
    await d.settle();
    expect((await pending)?.timestamp).toBe(f2.timestamp);
    await read('s', 2);
    expect(copies(d.log)).toHaveLength(1);
  });

  it('copies the other wanted channels at the next turn after one channel’s first read', async () => {
    const { d, r, fold, read } = ring();
    r.want('s');
    r.fold(fold(1));
    r.turn(2);
    const f2 = fold(2);
    r.fold(f2);
    const p = read('p', 2);
    r.want('s');
    r.want('p');
    r.turn(3);
    expect(copies(d.log)).toEqual([
      'copy out->readback 0+16',
      'copy out->readback 16+48',
      'copy out->readback 0+16',
    ]);
    await d.settle();
    expect((await read('s', 3))?.timestamp).toBe(f2.timestamp);
    expect((await read('p', 3))?.timestamp).toBe(f2.timestamp);
    expect(await read('p', 3)).toBe(await p);
  });

  it('copies the current fold rather than give a copy from before a gap', async () => {
    const { d, r, fold, read } = ring();
    r.want('s');
    r.fold(fold(1));
    r.turn(2);
    await d.settle();
    const f101 = fold(101);
    r.want('s');
    r.turn(101);
    r.fold(f101);
    const pending = read('s', 101);
    expect(copies(d.log)).toHaveLength(2);
    await d.settle();
    expect((await pending)?.timestamp).toBe(f101.timestamp);
  });

  it('holds three staging buffers at most, and skips a frame rather than wait', async () => {
    const { d, r, fold, read } = ring();
    const folds = [1, 2, 3, 4].map((frame) => fold(frame));
    for (const f of folds) {
      r.want('s');
      r.fold(f);
      r.turn(f.frame + 1);
    }
    expect(d.made('readback')).toBe(3);
    expect(copies(d.log)).toHaveLength(3);
    await d.settle();
    const got = await read('s', 5);
    expect(got?.timestamp).toBe(folds[2]?.timestamp);
    expect(got?.timestamp).toBeLessThan(folds[3]?.timestamp as number);
  });

  it('a first read with every slot busy takes a staging buffer of its own', async () => {
    const { d, r, fold, read } = ring();
    for (const frame of [1, 2, 3]) {
      r.want('s');
      r.fold(fold(frame));
      r.turn(frame + 1);
    }
    r.fold(fold(4));
    const pending = read('p', 4);
    expect(d.made('readback')).toBe(4);
    await d.settle();
    expect(await pending).not.toBeNull();
    expect(d.destroyed).toEqual(['readback']);
  });

  it('reuses a free staging buffer, and remakes one only when it is too small', async () => {
    const { d, r, fold } = ring();
    r.want('s');
    r.fold(fold(1));
    r.turn(2);
    await d.settle();
    r.want('s');
    r.fold(fold(2));
    r.turn(3);
    await d.settle();
    expect(d.made('readback')).toBe(1);
    r.want('s');
    r.want('p');
    r.fold(fold(3));
    r.turn(4);
    expect(d.destroyed).toEqual(['readback']);
    expect(d.made('readback')).toBe(2);
  });

  it('a held read keeps its values', async () => {
    const { d, r, fold, fill, read } = ring();
    fill(0);
    r.want('s');
    r.fold(fold(1));
    r.turn(2);
    await d.settle();
    const held = (await read('s', 2)) as GpuRead<string>;
    for (let frame = 2; frame < 7; frame++) {
      fill(frame * 100);
      r.want('s');
      r.fold(fold(frame));
      r.turn(frame + 1);
      await d.settle();
      expect((await read('s', frame + 1))?.values[0]).toBe(frame * 100);
    }
    expect(d.made('readback')).toBe(1);
    expect(Array.from(held.values)).toEqual([0, 1, 2, 3]);
  });

  it('forget: a waiting read keeps its own list, and the next read copies the current fold', async () => {
    const { d, r, fold, read } = ring();
    r.want('s');
    r.fold(fold(1));
    r.turn(2);
    const waiting = read('s', 2);
    r.forget();
    const f2 = fold(2, ['d', 'c']);
    r.fold(f2);
    const next = read('s', f2.frame);
    expect(copies(d.log)).toEqual(['copy out->readback 0+16', 'copy out->readback 0+8']);
    await d.settle();
    expect((await waiting)?.subjects).toEqual(abcd);
    const got = await next;
    expect(got?.subjects).toEqual(['d', 'c']);
    expect(got?.values).toHaveLength(2);
  });

  it('close resolves waiting reads with null and destroys every staging buffer', async () => {
    const { d, r, fold, read } = ring();
    r.want('s');
    r.fold(fold(1));
    r.turn(2);
    const waiting = read('s', 2);
    r.close(true);
    expect(await waiting).toBeNull();
    expect(d.destroyed).toEqual(['readback']);
    expect(d.made('readback')).toBe(1);
    r.fold(fold(2));
    expect(await read('s', 3)).toBeNull();
    expect(copies(d.log)).toHaveLength(1);
    await d.settle();
  });

  for (const outcome of ['refuse', 'settle'] as const) {
    it(`device loss resolves waiting reads with null and destroys nothing (maps ${outcome}d)`, async () => {
      const { d, r, fold, read } = ring();
      r.want('s');
      r.fold(fold(1));
      r.turn(2);
      const waiting = read('s', 2);
      r.close(false);
      if (outcome === 'refuse') d.refuse();
      await d.settle();
      expect(await waiting).toBeNull();
      expect(d.destroyed).toEqual([]);
      expect(await read('s', 3)).toBeNull();
      r.close(true);
      expect(d.destroyed).toEqual([]);
    });
  }
});
