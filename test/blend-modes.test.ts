import { describe, expect, it } from 'vitest';
import { add, blendMode, darken, lighten, multiply, screen } from '../src/blend-modes.js';
import { kit, last, mul } from '../src/channels.js';
import { color, css, ink, oklab, toHex } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Channel } from '../src/types.js';

interface Pose {
  tint: number[];
}
interface Part {
  id: string;
}
const part = { id: 'a' };
const holds = (value: number[]) =>
  patch<Part, Pose>(0, () => ({ tint: value }), { writes: ['tint'] });

/** The pose of `voices`, each a color and a weight, folded by `tint`. */
function pose(tint: Channel<number[]>, voices: [number, number][]): number[] {
  const m = mix<Part, Pose>(kit<Pose>({ tint }));
  for (const [rgb, weight] of voices) m.cue({ patch: holds(oklab(rgb)), weight });
  m.sync(0);
  return m.probe(part).tint as number[];
}

const lin = (byte: number) => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const enc = (v: number) => {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};
/** `f` applied per axis in linear light to `a` and `b`, as 0xrrggbb. */
const per = (a: number, b: number, f: (x: number, y: number) => number) =>
  [16, 8, 0].reduce((out, s) => out | (enc(f(lin((a >> s) & 0xff), lin((b >> s) & 0xff))) << s), 0);

const UNDER = 0x6699cc;
const LAYER = 0xcc6633;
const MODES = {
  multiply: [multiply, (u: number, l: number) => u * l],
  screen: [screen, (u: number, l: number) => u + l - u * l],
  add: [add, (u: number, l: number) => u + l],
  lighten: [lighten, Math.max],
  darken: [darken, Math.min],
} as const;

describe('blend modes on a color channel', () => {
  for (const [name, [rule, f]] of Object.entries(MODES)) {
    for (const of of [color, ink]) {
      it(`${of.name}(${name}()) lays one voice over under in linear light`, () => {
        const p = pose(of(rule()), [[LAYER, 1]]);
        expect(toHex(p, UNDER)).toBe(per(UNDER, LAYER, f));
        expect(blendMode(p)).toBe(name === 'add' ? 'plus-lighter' : name);
      });
    }

    it(`${name} folds the same in any order`, () => {
      const a = pose(color(rule()), [
        [LAYER, 0.7],
        [0x3399ff, 0.4],
        [0xeeee00, 1],
      ]);
      const b = pose(color(rule()), [
        [0xeeee00, 1],
        [LAYER, 0.7],
        [0x3399ff, 0.4],
      ]);
      expect(toHex(b, UNDER)).toBe(toHex(a, UNDER));
    });

    it(`${name} with no voices, or at weight 0, leaves under as it is`, () => {
      expect(toHex(pose(color(rule()), []), UNDER)).toBe(UNDER);
      expect(toHex(pose(color(rule()), [[LAYER, 0]]), UNDER)).toBe(UNDER);
    });
  }

  it('stacks two layers as the mode stacked twice', () => {
    const p = pose(color(multiply()), [
      [LAYER, 1],
      [0x99ff99, 1],
    ]);
    const third = (x: number, s: number) => lin((x >> s) & 0xff);
    expect(toHex(p, UNDER)).toBe(
      [16, 8, 0].reduce(
        (out, s) => out | (enc(third(UNDER, s) * third(LAYER, s) * third(0x99ff99, s)) << s),
        0,
      ),
    );
  });

  it('takes a weight as layer opacity for multiply, screen and add', () => {
    const w = 0.4;
    for (const [rule, f] of [MODES.multiply, MODES.screen, MODES.add]) {
      const p = pose(color(rule()), [[LAYER, w]]);
      expect(toHex(p, UNDER)).toBe(per(UNDER, LAYER, (u, l) => u + (f(u, l) - u) * w));
    }
  });

  it('takes coverage times weight as opacity', () => {
    const [L = 0, a = 0, b = 0] = oklab(LAYER);
    const m = mix<Part, Pose>(kit<Pose>({ tint: color(multiply()) }));
    m.cue({ patch: holds([L * 0.5, a * 0.5, b * 0.5, 0.5]), weight: 0.8 });
    m.sync(0);
    expect(toHex(m.probe(part).tint as number[], UNDER)).toBe(
      per(UNDER, LAYER, (u, l) => u + (u * l - u) * 0.4),
    );
  });

  it('gives css the one layer the voices add up to, opaque', () => {
    const p = pose(color(multiply()), [[LAYER, 1]]);
    expect(css(p)).toMatch(/^oklab\([^/]+\)$/);
    expect(toHex(p, 0xffffff)).toBe(LAYER);
    expect(blendMode(pose(color(), [[LAYER, 1]]))).toBe('normal');
  });

  it('travels straight across OKLab under color and round the hue under ink', () => {
    const sweep = keys<Part, Pose>(1000, [
      { at: 0, delta: { tint: oklab(0xff0000) } },
      { at: 1, delta: { tint: oklab(0x0000ff) } },
    ]);
    const at = (tint: Channel<number[]>) => {
      const m = mix<Part, Pose>(kit<Pose>({ tint }));
      m.cue({ patch: sweep });
      m.sync(500);
      return toHex(m.probe(part).tint as number[], 0xffffff);
    };
    // Multiply over white shows the layer itself, so each matches its replacing twin.
    expect(at(color(multiply()))).toBe(at(color(last())));
    expect(at(ink(multiply()))).toBe(at(ink(last())));
    expect(at(ink(multiply()))).not.toBe(at(color(multiply())));
  });

  it('refuses a merge rule that is not one', () => {
    expect(() => color(mul())).toThrow(/blend mode/);
    expect(() => ink(mul())).toThrow(/blend mode/);
  });
});

describe('blend modes as numeric channels', () => {
  const fold = (ch: Channel<number>, values: [number, number][]) => {
    const m = mix<Part, { v: number }>(kit<{ v: number }>({ v: ch }));
    for (const [v, weight] of values)
      m.cue({ patch: patch<Part, { v: number }>(0, () => ({ v }), { writes: ['v'] }), weight });
    m.sync(0);
    return m.probe(part).v as number;
  };
  const two: [number, number][] = [
    [0.5, 1],
    [0.4, 1],
  ];

  it('fold two numbers by their mode', () => {
    expect(fold(multiply(), two)).toBeCloseTo(0.2, 12);
    expect(fold(screen(), two)).toBeCloseTo(0.7, 12);
    expect(fold(add(), two)).toBeCloseTo(0.9, 12);
    expect(fold(lighten(), two)).toBeCloseTo(0.5, 12);
    expect(fold(darken(), two)).toBeCloseTo(0.4, 12);
  });

  it('fade a layer toward rest by weight', () => {
    expect(fold(screen(), [[0.5, 0.5]])).toBeCloseTo(0.25, 12);
    expect(fold(darken(), [[0.5, 0.5]])).toBeCloseTo(0.75, 12);
  });
});
