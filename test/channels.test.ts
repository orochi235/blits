import { describe, expect, it } from 'vitest';
import { foldNumber, kit, last, max, mul, numericOf, sum, vec } from '../src/channels.js';
import { mixHex } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
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
    const channel: Channel<number[]> = vec(3, sum());
    const rest = channel.rest as number[];
    const scale = channel.scale as (v: number[], w: number) => number[];
    expect(rest).toEqual([0, 0, 0]);
    const v = [1, -2, 3.5];
    closeAll(channel.merge(v, rest), v);
    closeAll(scale(v, 1), v);
    closeAll(scale(v, 0), rest);
    closeAll(channel.lerp(v, rest, 0.5), [0.5, -1, 1.75]);
  });

  it('fold into an accumulator is merge of scale, on every channel that has one', () => {
    const channels: [string, Channel<number[]>][] = [
      ['vec sum', vec(3, sum())],
      ['vec mul', vec(3, mul())],
      ['vec max', vec(3, max())],
    ];
    const r = numbers();
    const next = () => r.next().value as number;
    for (const [, channel] of channels) {
      expect(channel.fold).toBeDefined();
      for (const w of weights) {
        const a = [next(), next(), next()];
        const v = [next(), next()];
        const want = channel.merge(a, channel.scale?.(v, w) as number[]);
        const into = [...a];
        expect(channel.fold?.(into, v, w)).toBe(into);
        closeAll(into, want);
      }
    }
    expect(vec(3, last<number>()).fold).toBeUndefined();
  });

  it('vec: rest is copied, not shared, so a fold cannot write into it', () => {
    const channel = vec(2, sum());
    const first = channel.rest as number[];
    expect(channel.merge([1, 1], [2, 2])).toEqual([3, 3]);
    expect(first).toEqual([0, 0]);
  });

  it('vec: a missing axis reads as the channel rest, not zero', () => {
    const channel: Channel<number[]> = vec(3, mul());
    expect(channel.merge([2, 2], [1, 1, 1])).toEqual([2, 2, 1]);
    expect(channel.lerp([2, 2], [1, 1, 1], 0.5)).toEqual([1.5, 1.5, 1]);
    expect(channel.scale?.([2, 2], 1)).toEqual([2, 2, 1]);
  });

  it('mixHex: lerps in OKLCH and ends where it was told to', () => {
    expect(mixHex(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixHex(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x636363);
    expect(mixHex(0xff0000, 0x0000ff, 0.5)).toBe(0xba00c2);
  });

  it('mixHex: a gray end takes the other end’s hue rather than swinging through one of its own', () => {
    expect(mixHex(0x808080, 0xff0000, 0.5)).toBe(0xc66356);
    expect(mixHex(0xff0000, 0x808080, 0.5)).toBe(0xc66356);
  });

  it('hex: hue goes the short way round', () => {
    // red to green passes through orange, not through blue
    expect(mixHex(0xff0000, 0x00ff00, 0.5)).toBe(0xf99500);
  });
});

describe('bounds', () => {
  interface Look {
    opacity: number;
    lift: number;
    at: number[];
  }
  const LOOK = kit<Look>({
    opacity: mul({ bounds: [0, 1] }),
    lift: sum({ bounds: [0, 1] }),
    at: vec(2, sum({ bounds: [-10, 10] })),
  });
  const s = { id: 'a' };

  it('clamps stacked voices into the range, axis by axis for a vector', () => {
    const m = mix<{ id: string }, Look>(LOOK);
    const p = patch<{ id: string }, Look>(0, () => ({ lift: 0.7, at: [8, -3] }), {
      writes: ['lift', 'at'],
    });
    m.cue({ patch: p });
    m.cue({ patch: p });
    m.sync(0);
    expect(m.probe(s)).toMatchObject({ lift: 1, at: [10, -6] });
  });

  it('stops a retarget that carries speed flat at the bound', () => {
    // Rising at 1/300 a ms, retargeted at 0.9 toward 0.95: carried, it would pass 1.
    const peak = (k: typeof LOOK) => {
      const m = mix<{ id: string }, Look>(k);
      const rising = m.cue({
        patch: patch<{ id: string }, Look>(300, (phase) => ({ lift: phase }), { writes: ['lift'] }),
      });
      m.sync(0);
      m.probe(s);
      m.sync(270);
      m.probe(s);
      rising.weight = 0;
      m.cue({
        patch: keys<{ id: string }, Look>(400, [{ at: 1, delta: { lift: 0.95 } }]),
        from: 'current',
        loop: false,
      });
      let top = 0;
      for (let t = 280; t <= 670; t += 10) {
        m.sync(t);
        top = Math.max(top, m.probe(s).lift);
      }
      return top;
    };
    expect(peak(kit<Look>({ opacity: mul(), lift: sum(), at: vec(2, sum()) }))).toBeGreaterThan(1);
    expect(peak(LOOK)).toBe(1);
  });

  it('are part of the kind, so a patch written for one range is refused by another', () => {
    expect(mul({ bounds: [0, 1] }).kind).toBe('mul[0, 1]');
    expect(vec(2, sum({ bounds: [-10, 10] })).kind).toBe('vec(2, sum[-10, 10])');
    const p = patch<{ id: string }, Look>(0, () => ({ opacity: 0.5 }), { kit: { opacity: mul() } });
    expect(() => mix<{ id: string }, Look>(LOOK).cue({ patch: p })).toThrow(/mul\[0, 1\].*mul/);
  });
});

describe('numericOf and foldNumber', () => {
  it('registers the stock numeric channels, and only the objects they return', () => {
    expect(numericOf(sum())).toEqual({ op: 'sum', axes: 1 });
    expect(numericOf(mul({ bounds: [0, 1] }))).toEqual({ op: 'mul', axes: 1 });
    expect(numericOf(max())).toEqual({ op: 'max', axes: 1 });
    expect(numericOf(vec(3, sum()))).toEqual({ op: 'sum', axes: 3 });
    expect(numericOf(last<number>({ lerp: mixHex }))).toBeUndefined();
    expect(numericOf({ ...sum() })).toBeUndefined();
  });

  it('folds exactly as the channel merges a scaled value', () => {
    for (const [make, op] of [
      [sum, 'sum'],
      [mul, 'mul'],
      [max, 'max'],
    ] as const) {
      const c = make();
      for (const [acc, v, w] of [
        [0, 0.1, 1],
        [1, 0.1, 1],
        [0.3, -0.25, 0.7],
        [2, -0, 0.5],
        [-0, -0, 0],
        [0, 0, 0.3],
        [-1.5, 2.5, 0],
        [0.2, -3, 1],
      ] as const) {
        const want = c.merge(acc, (c.scale as (v: number, w: number) => number)(v, w));
        expect(Object.is(foldNumber(op, acc, v, w), want)).toBe(true);
      }
    }
  });
});
