import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kit, mix, mul, patch } from '../src/index.js';
import type { Finder } from '../src/types.js';

type Dot = { id: number };
type Pose = { gain: number };

const K = kit({ gain: mul() });
const glowPatch = () => patch<Dot, Pose>(1000, () => ({ gain: 1.5 }), { writes: ['gain'] });

describe('place', () => {
  it('hands each subject an index it keeps, and the next subject one a drop freed', () => {
    const m = mix<string, Pose>(K);
    expect(['a', 'b', 'c'].map((s) => m.place(s))).toEqual([0, 1, 2]);
    expect(m.place('b')).toBe(1);
    m.drop('b');
    expect(m.place('d')).toBe(1);
    expect(m.place('e')).toBe(3);
    expect(m.place('b')).toBe(4);
  });

  it("frees a collected subject's index for the next subject", async () => {
    setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc') as () => void;
    const m = mix<Dot, Pose>(K);
    const kept = { id: 0 };
    m.place(kept);
    const ref = (() => {
      const gone = { id: 1 };
      expect(m.place(gone)).toBe(1);
      return new WeakRef(gone);
    })();
    // A finalizer runs some time after its WeakRef clears.
    const freed = () => (m as unknown as { places: { free: number[] } }).places.free.length > 0;
    for (let i = 0; i < 50 && !freed(); i++) {
      await new Promise((r) => setTimeout(r, 0));
      gc();
    }
    expect(ref.deref()).toBeUndefined();
    expect(m.place({ id: 2 })).toBe(1);
  });

  it('numbers after plot from the end of its list, and a reused index reads what xy holds there', () => {
    const m = mix<string, Pose>(K);
    const xy = new Float64Array([0, 0, 5, 5]);
    m.plot(['a', 'b'], xy, 1);
    m.drop('b');
    expect(m.place('c')).toBe(1);
    expect(m.place('d')).toBe(2);
    m.put('c', 0, 1);
    expect(xy[3]).toBe(1);
    expect(() => m.put('d', 0, 0)).toThrow(/past the positions plot was given/);
    expect(() => m.put('z', 0, 0)).toThrow(/place or plot it first/);
  });

  for (const lanes of [true, false])
    it(`gives a subject no position until put, lanes ${lanes ? 'on' : 'off'}`, () => {
      const m = mix<string, Pose>(K, { lanes });
      for (const s of ['a', 'b']) m.place(s);
      const area = { x: 0, y: 0, r: 2 };
      m.cue({ patch: glowPatch() as never, weight: m.around(area), loop: true });
      const read = (t: number) => {
        m.sync(t);
        return ['a', 'b'].map((s) => m.probe(s).gain);
      };
      expect(read(0)).toEqual([1, 1]);
      m.put('a', 0, 0);
      m.put('b', 1, 0);
      expect(read(16)).toEqual([1.5, 1.25]);
      m.put('b', 9, 9);
      expect(read(32)).toEqual([1.5, 1]);
    });
});

describe('a within finder', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const setup = (lanes: boolean, find: Finder['find']) => {
    const m = mix<string, Pose>(K, { lanes });
    const ids = ['a', 'b', 'c', 'd'];
    for (const s of ids) m.place(s);
    const glow = m.cue({
      patch: glowPatch() as never,
      weight: () => 1,
      loop: true,
      within: { find },
    });
    const read = (t: number) => {
      m.sync(t);
      return ids.map((s) => m.probe(s).gain);
    };
    return { m, glow, read };
  };

  for (const lanes of [true, false]) {
    const on = `lanes ${lanes ? 'on' : 'off'}`;
    it(`reads a repeat once, and skips an index no subject holds, ${on}`, () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { m, read } = setup(lanes, (out) => {
        out.set([2, 2, 1]);
        return 3;
      });
      expect(read(0)).toEqual([1, 1.5, 1.5, 1]);
      m.drop('b');
      expect(read(16)).toEqual([1, 1, 1.5, 1]);
    });

    it(`refuses a count it could not have written, ${on}`, () => {
      const { read } = setup(lanes, (out) => out.length + 1);
      expect(() => read(0)).toThrow(/not a count of the indices it wrote/);
    });

    it(`warns once, outside production, for an index place never handed out, ${on}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { read } = setup(lanes, (out) => {
        out.set([0, 9]);
        return 2;
      });
      expect(read(0)).toEqual([1.5, 1, 1, 1]);
      read(16);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/found index 9, which place never handed out/);
    });

    it(`warns once, outside production, where the signal is above 0 for a subject it did not find, ${on}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { read } = setup(lanes, (out) => {
        out[0] = 0;
        return 1;
      });
      for (let f = 0; f < 20; f++) read(f * 16);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/for a subject its within finder did not find/);
    });
  }
});
