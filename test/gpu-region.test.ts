import { describe, expect, it } from 'vitest';
import { type Entry, Regions } from '../src/gpu/region.js';

function entry(n: number, fill: number): Entry {
  return { owner: {}, values: new Float32Array(n).fill(fill) };
}

describe('Regions', () => {
  it('keeps a survivor where it was when another departs', () => {
    const regions = new Regions();
    const [a, b, c] = [entry(4, 1), entry(4, 2), entry(4, 3)] as [Entry, Entry, Entry];
    regions.frame([a, b, c]);
    const p = regions.frame([a, c]);
    expect(p.offsets).toEqual([0, 8]);
    expect(p.changed).toEqual([]);
    expect([...regions.data.subarray(8, 12)]).toEqual([3, 3, 3, 3]);
  });

  it('reuses a region for values that shrank, and moves values that grew', () => {
    const regions = new Regions();
    const owner = {};
    regions.frame([{ owner, values: new Float32Array(8).fill(1) }]);
    const shrunk = regions.frame([{ owner, values: new Float32Array(4).fill(2) }]);
    expect(shrunk.offsets).toEqual([0]);
    expect(shrunk.changed).toEqual([[0, 16]]);

    const length = regions.length;
    const grown = regions.frame([{ owner, values: new Float32Array(12).fill(3) }]);
    expect(grown.offsets).toEqual([length]);
    expect(grown.changed).toEqual([[length * 4, (length + 12) * 4]]);
  });

  it('compacts once holes outweigh the live values', () => {
    const regions = new Regions();
    const all = Array.from({ length: 10 }, () => entry(16, 1));
    regions.frame(all);
    const p = regions.frame([all[9] as Entry]);
    expect(p.offsets).toEqual([0]);
    expect(p.changed).toEqual([[0, 64]]);
    expect(regions.length).toBe(16);
  });

  it('compacts past cap', () => {
    const regions = new Regions();
    const a = entry(8, 1);
    const b = entry(8, 2);
    regions.frame([a, b]);
    const bigger = { owner: a.owner, values: new Float32Array(12).fill(3) };
    const p = regions.frame([bigger, b], 16);
    expect(p.offsets).toEqual([0, 12]);
    expect(regions.length).toBe(20);
  });

  it('doubles its store and keeps what it held', () => {
    const regions = new Regions();
    const entries = Array.from({ length: 20 }, (_, i) => entry(1, i + 1));
    const p = regions.frame(entries);
    const size = regions.data.length;
    expect(size).toBeGreaterThanOrEqual(20);
    expect(2 ** Math.log2(size)).toBe(size);
    entries.forEach((e, i) => {
      expect(regions.data[p.offsets[i] as number]).toBe(e.values[0]);
    });
  });

  it('merges touching ranges', () => {
    const regions = new Regions();
    const p = regions.frame([entry(4, 1), entry(4, 2)]);
    expect(p.changed).toEqual([[0, 32]]);
  });
});
