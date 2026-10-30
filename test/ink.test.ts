import { describe, expect, it } from 'vitest';
import { kit, last, max, mul, numericOf, sum } from '../src/channels.js';
import { color, css, ink, mixHex, oklab, toHex } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';

interface Pose {
  tint: number[];
}
interface Part {
  id: string;
}
const part = { id: 'a' };
const holds = (value: number[]) =>
  patch<Part, Pose>(0, () => ({ tint: value }), { writes: ['tint'] });

const RED = 0xff0000;
const BLUE = 0x0000ff;
const CYAN = 0x00ffff;
const GRAY = 0x808080;

/** OKLab `[L, a, b]` as lightness, chroma and hue. */
const lch = (L: number, a: number, b: number) => ({ L, C: Math.hypot(a, b), h: Math.atan2(b, a) });
const of = (rgb: number) => {
  const [L = 0, a = 0, b = 0] = oklab(rgb);
  return lch(L, a, b);
};
/** The color a pose shows, unclipped, read back from its `css`. */
const shown = (pose: number[]) => {
  const [L = 0, a = 0, b = 0] = (css(pose).match(/-?[\d.e-]+/g) ?? []).map(Number);
  return lch(L, a, b);
};

/** The pose two voices of `x` at `wx` and `y` at `wy` should fold to on an ink channel. */
const blend = (x: number, wx: number, y: number, wy: number) => {
  const p = oklab(x);
  const q = oklab(y);
  const C = (v: number[]) => Math.hypot(v[1] as number, v[2] as number);
  return [
    (p[0] as number) * wx + (q[0] as number) * wy,
    (p[1] as number) * wx + (q[1] as number) * wy,
    (p[2] as number) * wx + (q[2] as number) * wy,
    C(p) * wx + C(q) * wy,
    wx + wy,
  ];
};

const both = (run: (lanes: boolean) => void) => {
  for (const lanes of [false, true]) run(lanes);
};

describe('ink()', () => {
  it('sums each voice as [w·L, w·a, w·b, w·C, w], the chroma of what it contributed', () => {
    both((lanes) => {
      const m = mix<Part, Pose>(kit<Pose>({ tint: ink() }), { lanes });
      m.cue({ patch: holds(oklab(RED)) });
      m.cue({ patch: holds(oklab(BLUE)), weight: 0.5 });
      m.sync(0);
      const pose = m.probe(part).tint;
      const want = blend(RED, 1, BLUE, 0.5);
      expect(pose.length).toBe(5);
      for (let i = 0; i < 5; i++)
        expect(pose[i], `lanes ${lanes} [${i}]`).toBeCloseTo(want[i] as number, 12);
    });
  });

  it('shows overlapping voices at their chroma-weighted hue and their average chroma', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: ink() }));
    m.cue({ patch: holds(oklab(RED)), weight: 0.75 });
    m.cue({ patch: holds(oklab(BLUE)), weight: 0.25 });
    m.sync(0);
    const pose = m.probe(part).tint;
    const r = oklab(RED);
    const b = oklab(BLUE);
    const a = 0.75 * (r[1] as number) + 0.25 * (b[1] as number);
    const bb = 0.75 * (r[2] as number) + 0.25 * (b[2] as number);
    const got = shown(pose);
    expect(got.L).toBeCloseTo(0.75 * (r[0] as number) + 0.25 * (b[0] as number), 12);
    expect(got.h).toBeCloseTo(Math.atan2(bb, a), 12);
    expect(got.C).toBeCloseTo(0.75 * of(RED).C + 0.25 * of(BLUE).C, 12);
  });

  it('blends red and blue at equal weight to a vivid purple, not the straight mix’s dull one', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: ink() }));
    m.cue({ patch: holds(oklab(RED)), weight: 0.5 });
    m.cue({ patch: holds(oklab(BLUE)), weight: 0.5 });
    m.sync(0);
    const inked = shown(m.probe(part).tint);
    const straight = mix<Part, Pose>(kit<Pose>({ tint: color() }));
    straight.cue({ patch: holds(oklab(RED)), weight: 0.5 });
    straight.cue({ patch: holds(oklab(BLUE)), weight: 0.5 });
    straight.sync(0);
    const flat = shown(straight.probe(part).tint);
    expect(inked.h).toBeCloseTo(flat.h, 12);
    expect(inked.C).toBeGreaterThan(flat.C + 0.05);
    expect(inked.C).toBeGreaterThan(0.25);
  });

  it('pulls no hue for a gray voice, which only lightens and dulls by its share', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: ink() }));
    m.cue({ patch: holds(oklab(RED)), weight: 0.5 });
    m.cue({ patch: holds(oklab(GRAY)), weight: 0.5 });
    m.sync(0);
    const got = shown(m.probe(part).tint);
    expect(got.h).toBeCloseTo(of(RED).h, 6);
    expect(got.C).toBeCloseTo((of(RED).C + of(GRAY).C) / 2, 12);
  });

  it('shows gray where two hues cancel exactly', () => {
    const v = [0.6, 0.1, -0.05, 1];
    const w = [0.6, -0.1, 0.05, 1];
    const m = mix<Part, Pose>(kit<Pose>({ tint: ink() }));
    m.cue({ patch: holds(v), weight: 0.5 });
    m.cue({ patch: holds(w), weight: 0.5 });
    m.sync(0);
    const pose = m.probe(part).tint;
    expect(pose[3]).toBeCloseTo(Math.hypot(0.1, 0.05), 12);
    expect(toHex(pose)).toBe(toHex([0.6, 0, 0, 1]));
    expect(css(pose)).toBe(css([0.6, 0, 0, 1]));
  });

  it('rests at no coverage, which toHex reads as what is under it', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: ink() }));
    m.sync(0);
    expect(m.probe(part).tint).toEqual([0, 0, 0, 0, 0]);
    expect(toHex(m.probe(part).tint, 0x445566)).toBe(0x445566);
  });

  it('travels round the hue, as color(last(), ...) did with an oklch lerp', () => {
    const channel = ink();
    for (const [x, y, u] of [
      [RED, CYAN, 0.5],
      [RED, BLUE, 0.25],
      [GRAY, BLUE, 0.6],
    ] as const)
      expect(toHex(channel.lerp(oklab(x), oklab(y), u))).toBe(mixHex(x, y, u));
  });

  it('lerps five-number poses by the color they show, and ends exactly at each end', () => {
    const channel = ink();
    const pose = blend(RED, 0.5, BLUE, 0.5);
    expect(channel.lerp(pose, oklab(CYAN), 0)).toEqual(pose);
    expect(toHex(channel.lerp(pose, oklab(CYAN), 1))).toBe(CYAN);
    const half = shown(channel.lerp(pose, oklab(CYAN), 0.5));
    expect(half.C).toBeCloseTo((shown(pose).C + of(CYAN).C) / 2, 12);
  });

  it("lerps from no coverage to the other end's color, fading only coverage", () => {
    const out = ink().lerp([0, 0, 0, 0], oklab(BLUE), 0.5);
    expect(out[4]).toBeCloseTo(0.5, 12);
    expect(toHex(out.map((v) => v * 2))).toBe(BLUE);
  });

  it('crossfades two keyframes round the hue, on lanes and off', () => {
    both((lanes) => {
      const m = mix<Part, Pose>(kit<Pose>({ tint: ink() }), { lanes });
      m.cue({
        patch: keys<Part, Pose>(1, [
          { at: 0, delta: { tint: oklab(RED) } },
          { at: 1, delta: { tint: oklab(CYAN) } },
        ]),
      });
      m.sync(0.5);
      expect(toHex(m.probe(part).tint), `lanes ${lanes}`).toBe(mixHex(RED, CYAN, 0.5));
    });
  });

  it('names its rule, folds as its own on lanes, and refuses mul, max and bounds', () => {
    expect(ink().kind).toBe('ink(sum)');
    expect(ink(sum()).kind).toBe('ink(sum)');
    expect(numericOf(ink())).toEqual({ op: 'own', axes: 5 });
    expect(() => ink(mul())).toThrow(/ink/);
    expect(() => ink(max())).toThrow(/ink/);
    expect(() => ink(sum({ bounds: [0, 1] }))).toThrow(/ink/);
  });
});

describe('ink(last())', () => {
  it('replaces with the last voice to pass, at four numbers, and travels round the hue', () => {
    const channel = ink(last());
    expect(channel.kind).toBe('ink(last)');
    expect(numericOf(channel)).toEqual({ op: 'last', axes: 4 });
    expect(toHex(channel.lerp(oklab(RED), oklab(CYAN), 0.5))).toBe(mixHex(RED, CYAN, 0.5));
    const m = mix<Part, Pose>(kit<Pose>({ tint: channel }));
    m.cue({ patch: holds(oklab(RED)) });
    m.cue({ patch: holds(oklab(BLUE)), weight: 0.6 });
    m.sync(0);
    expect(m.probe(part).tint).toEqual(oklab(BLUE));
  });
});

describe('toHex and css on five numbers', () => {
  it('read the coverage from the fifth number and the chroma from the fourth', () => {
    const [L = 0, a = 0, b = 0] = oklab(BLUE);
    const C = Math.hypot(a, b);
    expect(toHex([L, a, b, C, 1])).toBe(BLUE);
    expect(toHex([L * 0.5, a * 0.5, b * 0.5, C * 0.5, 0.5], 0xffffff)).toBe(
      toHex([L * 0.5, a * 0.5, b * 0.5, 0.5], 0xffffff),
    );
    expect(toHex([0, 0, 0, 0, 0], 0x336699)).toBe(0x336699);
    expect(css([0.5, 0.1, 0, 0.2, 0.5])).toBe('oklab(1 0.4 0 / 0.5)');
    expect(css([0, 0, 0, 0, 0])).toBe('oklab(0 0 0 / 0)');
  });
});
