import { describe, expect, it } from 'vitest';
import { hex, last, max, mixHex, mul, sum, vec } from '../src/channels.js';
import type { Channel } from '../src/types.js';

/**
 * A deterministic sampler stands in for a property-testing dependency: the package ships zero
 * runtime deps and this is enough coverage to catch a law that only holds at the origin.
 */
function* numbers(): Generator<number> {
  let seed = 0x2f6e2b1;
  for (let i = 0; i < 200; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    yield ((seed / 0x7fffffff) * 8 - 4) as number;
  }
}

const weights = [0, 0.25, 1 / 3, 0.5, 0.75, 1];

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const closeAll = (a: readonly number[], b: readonly number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => {
    close(v, b[i] as number);
  });
};

describe('channel laws', () => {
  const scalars: [string, Channel<number>][] = [
    ['sum', sum()],
    ['mul', mul()],
    ['max', max()],
  ];

  for (const [name, channel] of scalars) {
    it(`${name}: join(v, rest) = v, scale(v, 1) = v, scale(v, 0) = rest`, () => {
      const rest = channel.rest as number;
      const scale = channel.scale as (v: number, w: number) => number;
      // `max` is an identity at 0 only on the values it is for: `dark` and `aperture` are 0..1.
      for (const raw of numbers()) {
        const v = name === 'max' ? Math.abs(raw) : raw;
        close(channel.merge(v, rest), v);
        close(channel.merge(rest, v), v);
        close(scale(v, 1), v);
        close(scale(v, 0), rest);
      }
    });

    it(`${name}: lerp(a, b, 0) = a and lerp(a, b, 1) = b`, () => {
      const it2 = numbers();
      for (const a of numbers()) {
        const b = it2.next().value ?? 0;
        close(channel.lerp(a, b, 0), a);
        close(channel.lerp(a, b, 1), b);
      }
    });

    it(`${name}: scale is monotonic in w between rest and v`, () => {
      const rest = channel.rest as number;
      const scale = channel.scale as (v: number, w: number) => number;
      for (const v of numbers()) {
        for (const w of weights) {
          const got = scale(v, w);
          const lo = Math.min(rest, v);
          const hi = Math.max(rest, v);
          expect(got).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(got).toBeLessThanOrEqual(hi + 1e-9);
        }
      }
    });
  }

  it('last: b wins, and it has no rest to fade toward', () => {
    const channel = last<string>();
    expect(channel.rest).toBeUndefined();
    expect(channel.scale).toBeUndefined();
    expect(channel.merge('a', 'b')).toBe('b');
    expect(channel.lerp('a', 'b', 0)).toBe('a');
    expect(channel.lerp('a', 'b', 1)).toBe('b');
  });

  it('vec: the laws hold down every axis', () => {
    const channel = vec(3, sum());
    const rest = channel.rest as number[];
    const scale = channel.scale as (v: number[], w: number) => number[];
    expect(rest).toEqual([0, 0, 0]);
    const v = [1, -2, 3.5];
    closeAll(channel.merge(v, rest), v);
    closeAll(scale(v, 1), v);
    closeAll(scale(v, 0), rest);
    closeAll(channel.lerp(v, rest, 0.5), [0.5, -1, 1.75]);
  });

  it('vec: rest is copied, not shared, so a fold cannot write into it', () => {
    const channel = vec(2, sum());
    const first = channel.rest as number[];
    expect(channel.merge([1, 1], [2, 2])).toEqual([3, 3]);
    expect(first).toEqual([0, 0]);
  });

  it('hex: lerps in sRGB and ends where it was told to', () => {
    expect(mixHex(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixHex(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(hex().merge(0x112233, 0x445566)).toBe(0x445566);
  });
});
