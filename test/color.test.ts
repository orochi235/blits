import { describe, expect, it, vi } from 'vitest';
import { kit, last, max, mul, numericOf, sum } from '../src/channels.js';
import { color, css, mixHex, oklab, toHex } from '../src/color.js';
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

describe('oklab and toHex', () => {
  it('convert a color to OKLab with full coverage and back', () => {
    const [L, a, b, w] = oklab(RED);
    expect(L).toBeCloseTo(0.628, 3);
    expect(a).toBeCloseTo(0.2249, 3);
    expect(b).toBeCloseTo(0.1258, 3);
    expect(w).toBe(1);
    for (const rgb of [0x000000, 0xffffff, RED, 0x123456, 0xabcdef, 0x808080])
      expect(toHex(oklab(rgb))).toBe(rgb);
  });

  it('lay a partial coverage over what is under it, black by default', () => {
    expect(toHex([0, 0, 0, 0], 0x336699)).toBe(0x336699);
    expect(toHex([0, 0, 0, 0])).toBe(0x000000);
    const [L = 0, a = 0, b = 0] = oklab(0xffffff);
    expect(toHex([L * 0.5, a * 0.5, b * 0.5, 0.5], 0x000000)).toBe(
      toHex(oklab(0xffffff).map((v, i) => (i < 3 ? v * 0.5 : 1))),
    );
  });

  it('cap coverage at 1, so stacked voices average rather than overshoot', () => {
    const doubled = oklab(BLUE).map((v) => v * 2);
    expect(toHex(doubled, 0xffffff)).toBe(BLUE);
  });

  it('css writes the color unpremultiplied with its coverage as alpha', () => {
    expect(css([0.5, 0.1, -0.1, 0.5])).toBe('oklab(1 0.2 -0.2 / 0.5)');
    expect(css([0.6, 0, 0, 2])).toBe('oklab(0.3 0 0 / 1)');
    expect(css([0, 0, 0, 0])).toBe('oklab(0 0 0 / 0)');
  });
});

describe('color()', () => {
  it('averages stacked voices in OKLab, carrying their summed weight as coverage', () => {
    for (const lanes of [false, true]) {
      const m = mix<Part, Pose>(kit<Pose>({ tint: color() }), { lanes });
      m.cue({ patch: holds(oklab(RED)) });
      m.cue({ patch: holds(oklab(BLUE)), weight: 0.5 });
      m.sync(0);
      const pose = m.probe(part).tint;
      const r = oklab(RED);
      const b = oklab(BLUE);
      for (let i = 0; i < 3; i++)
        expect(pose[i], `lanes ${lanes}`).toBeCloseTo((r[i] as number) + 0.5 * (b[i] as number), 9);
      expect(pose[3]).toBeCloseTo(1.5, 9);
    }
  });

  it('rests at no coverage, which toHex reads as what is under it', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: color() }));
    m.sync(0);
    expect(toHex(m.probe(part).tint, 0x445566)).toBe(0x445566);
  });

  it('runs on lanes as a stock four-axis sum, and refuses mul and max', () => {
    expect(numericOf(color())).toEqual({ op: 'sum', axes: 4 });
    expect(color().kind).toBe('color(sum)');
    expect(() => color(mul())).toThrow(/color/);
    expect(() => color(max())).toThrow(/color/);
    expect(() => color(sum({ bounds: [0, 1] }))).toThrow(/color/);
  });

  it('lerps per OKLab axis', () => {
    expect(toHex(color().lerp(oklab(RED), oklab(CYAN), 0.5))).toBe(0xd2a993);
  });

  it("keeps the deprecated lerp: 'oklch' overlapping straight and traveling round the hue, warning once", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const round = color({ lerp: 'oklch' });
    expect(round.kind).toBe('color(sum, oklch)');
    expect(numericOf(round)).toEqual({ op: 'own', axes: 4, folds: 'sum' });
    expect(toHex(round.lerp(oklab(RED), oklab(CYAN), 0.5))).toBe(mixHex(RED, CYAN, 0.5));
    expect(color({ lerp: 'oklab' }).kind).toBe('color(sum)');
    expect(color(last(), { lerp: 'oklch' }).kind).toBe('color(last, oklch)');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/deprecated.*ink\(\)/);
    warn.mockRestore();
    for (const lanes of [false, true]) {
      const m = mix<Part, Pose>(kit<Pose>({ tint: round }), { lanes });
      m.cue({ patch: holds(oklab(RED)) });
      m.cue({ patch: holds(oklab(BLUE)), weight: 0.5 });
      m.sync(0);
      const pose = m.probe(part).tint;
      const r = oklab(RED);
      const b = oklab(BLUE);
      expect(pose.length).toBe(4);
      for (let i = 0; i < 4; i++)
        expect(pose[i], `lanes ${lanes}`).toBeCloseTo((r[i] as number) + 0.5 * (b[i] as number), 9);
    }
  });

  it('crossfades two keyframes through the channel lerp, on lanes and off', () => {
    for (const lanes of [false, true]) {
      const m = mix<Part, Pose>(kit<Pose>({ tint: color() }), { lanes });
      m.cue({
        patch: keys<Part, Pose>(1, [
          { at: 0, delta: { tint: oklab(RED) } },
          { at: 1, delta: { tint: oklab(CYAN) } },
        ]),
      });
      m.sync(0.5);
      expect(toHex(m.probe(part).tint), `lanes ${lanes}`).toBe(0xd2a993);
    }
  });
});

describe('color(last())', () => {
  it('replaces: the last voice to pass wins, at full coverage', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: color(last()) }));
    m.cue({ patch: holds(oklab(RED)) });
    m.cue({ patch: holds(oklab(BLUE)), weight: 0.6 });
    m.sync(0);
    expect(toHex(m.probe(part).tint, 0xffffff)).toBe(BLUE);
  });

  it('names its rule in its kind, and lerps as color() does', () => {
    expect(color(last()).kind).toBe('color(last)');
    expect(toHex(color(last()).lerp(oklab(RED), oklab(CYAN), 0.5))).toBe(0xd2a993);
  });
});
