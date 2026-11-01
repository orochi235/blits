import { describe, expect, it, vi } from 'vitest';
import { blendMode } from '../src/blend-modes.js';
import { kit, sum } from '../src/channels.js';
import { color, css, ink, oklab, toHex } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import {
  colorBurn,
  colorDodge,
  colorMode,
  darkerColor,
  difference,
  divide,
  exclusion,
  hardLight,
  hardMix,
  hue,
  lighterColor,
  linearBurn,
  linearLight,
  luminosity,
  overlay,
  pinLight,
  saturation,
  softLight,
  subtract,
  vividLight,
} from '../src/stack-rules.js';
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

/** The pose of `voices`, each a color and a weight, folded by `tint`, cued in order. */
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
type Blend = (b: number, s: number) => number;
/** `layers`, each a color and an opacity, laid over `under` bottom first by `f`, as 0xrrggbb. */
const laid = (under: number, f: Blend, layers: [number, number][]) =>
  [16, 8, 0].reduce((out, s) => {
    let b = lin((under >> s) & 0xff);
    for (const [rgb, a] of layers) b += (f(b, lin((rgb >> s) & 0xff)) - b) * a;
    return out | (enc(b) << s);
  }, 0);

const hard: Blend = (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s));
const soft: Blend = (b, s) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};
const dodge: Blend = (b, s) => (b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s)));
const burn: Blend = (b, s) => (b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const vivid: Blend = (b, s) => (s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1));
const MODES = {
  overlay: [overlay, (b: number, s: number) => hard(s, b), 'overlay'],
  softLight: [softLight, soft, 'soft-light'],
  hardLight: [hardLight, hard, 'hard-light'],
  difference: [difference, (b: number, s: number) => Math.abs(b - s), 'difference'],
  colorDodge: [
    colorDodge,
    (b: number, s: number) => (b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s))),
    'color-dodge',
  ],
  colorBurn: [
    colorBurn,
    (b: number, s: number) => (b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
    'color-burn',
  ],
  exclusion: [exclusion, (b: number, s: number) => b + s - 2 * b * s, 'exclusion'],
  subtract: [subtract, (b: number, s: number) => Math.max(0, b - s), 'normal'],
  divide: [
    divide,
    (b: number, s: number) => (b === 0 ? 0 : s === 0 ? 1 : Math.min(1, b / s)),
    'normal',
  ],
  linearBurn: [linearBurn, (b: number, s: number) => Math.max(0, b + s - 1), 'normal'],
  vividLight: [vividLight, vivid, 'normal'],
  linearLight: [
    linearLight,
    (b: number, s: number) => Math.min(1, Math.max(0, b + 2 * s - 1)),
    'normal',
  ],
  pinLight: [
    pinLight,
    (b: number, s: number) => (s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
    'normal',
  ],
  hardMix: [hardMix, (b: number, s: number) => (b + s >= 1 ? 1 : 0), 'normal'],
} as const;

const UNDER = 0x6699cc;
const LAYER = 0xcc6633;
const OTHER = 0x2255ee;

describe('ordered blend modes on a color channel', () => {
  for (const [name, [rule, f, cssName]] of Object.entries(MODES)) {
    for (const of of [color, ink]) {
      it(`${of.name}(${name}()) lays one voice over under in linear light`, () => {
        const p = pose(of(rule()), [[LAYER, 1]]);
        expect(toHex(p, UNDER)).toBe(laid(UNDER, f, [[LAYER, 1]]));
        expect(blendMode(p)).toBe(cssName);
      });
    }

    it(`${name} lays its voices bottom first, in the order they were cued`, () => {
      const p = pose(color(rule()), [
        [LAYER, 1],
        [OTHER, 0.6],
      ]);
      expect(toHex(p, UNDER)).toBe(
        laid(UNDER, f, [
          [LAYER, 1],
          [OTHER, 0.6],
        ]),
      );
    });

    it(`${name} takes a weight times coverage as the layer's opacity`, () => {
      const [L = 0, a = 0, b = 0] = oklab(LAYER);
      const m = mix<Part, Pose>(kit<Pose>({ tint: color(rule()) }));
      m.cue({ patch: holds([L * 0.5, a * 0.5, b * 0.5, 0.5]), weight: 0.8 });
      m.sync(0);
      expect(toHex(m.probe(part).tint as number[], UNDER)).toBe(laid(UNDER, f, [[LAYER, 0.4]]));
    });

    it(`${name} with no voices, or at weight 0, leaves under as it is and rests`, () => {
      expect(toHex(pose(color(rule()), []), UNDER)).toBe(UNDER);
      const m = mix<Part, Pose>(kit<Pose>({ tint: color(rule()) }));
      m.cue({ patch: holds(oklab(LAYER)), weight: 0 });
      m.sync(0);
      expect(toHex(m.probe(part).tint as number[], UNDER)).toBe(UNDER);
      expect(m.atRest(part)).toBe(true);
    });
  }

  it('reads differently with its voices cued the other way round', () => {
    const one = pose(color(overlay()), [
      [LAYER, 1],
      [OTHER, 1],
    ]);
    const other = pose(color(overlay()), [
      [OTHER, 1],
      [LAYER, 1],
    ]);
    expect(toHex(one, UNDER)).not.toBe(toHex(other, UNDER));
  });

  it('lays a role down as one layer, its members lerped', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: color(difference()) }));
    m.cue({ patch: holds(oklab(LAYER)), weight: 0.5, role: 'swap' });
    m.cue({ patch: holds(oklab(OTHER)), weight: 0.5, role: 'swap' });
    m.sync(0);
    expect(m.probe(part).tint?.[1]).toBe(1);
  });

  it('gives css one layer at its opacity, for opacity and mix-blend-mode to lay on', () => {
    const p = pose(color(hardLight()), [[LAYER, 0.25]]);
    expect(css(p)).toMatch(/^oklab\([^/]+\/ 0\.25\)$/);
    expect(css(pose(color(hardLight()), []))).toBe('oklab(0 0 0 / 0)');
  });

  it('travels between two keys straight across OKLab, one layer a frame', () => {
    const m = mix<Part, Pose>(kit<Pose>({ tint: color(overlay()) }));
    m.cue({
      patch: keys<Part, Pose>(1000, [
        { at: 0, delta: { tint: oklab(LAYER) } },
        { at: 1, delta: { tint: oklab(OTHER) } },
      ]),
    });
    m.sync(500);
    expect(m.probe(part).tint?.[1]).toBe(1);
  });

  it('holds room for four layers, or as many as the rule gives, and leaves the rest off', () => {
    expect(pose(color(overlay()), [])).toHaveLength(2 + 4 * 4);
    const two = color(difference({ layers: 2 }));
    expect(two.kind).toBe('color(difference, 2)');
    expect(color(difference({ layers: 4 })).kind).toBe('color(difference)');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = pose(two, [
      [LAYER, 1],
      [OTHER, 0.5],
      [0xffffff, 1],
    ]);
    expect(p).toHaveLength(2 + 4 * 2);
    expect(toHex(p, UNDER)).toBe(
      laid(UNDER, (b, s) => Math.abs(b - s), [
        [LAYER, 1],
        [OTHER, 0.5],
      ]),
    );
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(() => overlay({ layers: 0 })).toThrow(/whole number of layers/);
  });

  it('folds beside a laned channel, over many subjects', () => {
    interface Both {
      tint: number[];
      gain: number;
    }
    const parts = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` }));
    const m = mix<Part, Both>(kit<Both>({ tint: color(softLight()), gain: sum() }));
    m.cue({ patch: patch<Part, Both>(0, () => ({ gain: 1 }), { writes: ['gain'] }) });
    m.cue({ patch: patch<Part, Both>(0, () => ({ tint: oklab(LAYER) }), { writes: ['tint'] }) });
    m.cue({
      patch: patch<Part, Both>(0, () => ({ tint: oklab(OTHER), gain: 2 }), {
        writes: ['tint', 'gain'],
      }),
      weight: 0.5,
    });
    for (let f = 0; f < 3; f++) {
      m.sync(f * 16);
      for (const p of parts) {
        const pose = m.probe(p);
        expect(pose.gain).toBe(2);
        expect(toHex(pose.tint as number[], UNDER)).toBe(
          laid(UNDER, soft, [
            [LAYER, 1],
            [OTHER, 0.5],
          ]),
        );
      }
    }
  });

  it('refuses to fold numbers on its own', () => {
    const m = mix<Part, { v: number }>(kit<{ v: number }>({ v: overlay() }));
    m.cue({ patch: patch<Part, { v: number }>(0, () => ({ v: 0.5 }), { writes: ['v'] }) });
    m.cue({ patch: patch<Part, { v: number }>(0, () => ({ v: 0.5 }), { writes: ['v'] }) });
    m.sync(0);
    expect(() => m.probe(part)).toThrow(/rule for color\(\) or ink\(\)/);
  });
});

describe('blend modes that lay a whole color', () => {
  const lch = (hex: number) => {
    const [L = 0, a = 0, b = 0] = oklab(hex);
    return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
  };
  const one = (rule: () => Channel<number>, layer: number, under: number) =>
    toHex(pose(color(rule()), [[layer, 1]]), under) as number;
  // Muted colors, so each result stays inside sRGB and nothing is clipped.
  const BASE = 0x8a7a6a;
  const TOP = 0x5a8a9a;

  it('hue takes the layer hue and keeps the chroma and lightness under it', () => {
    const out = lch(one(hue, TOP, BASE));
    expect(out.L).toBeCloseTo(lch(BASE).L, 2);
    expect(out.C).toBeCloseTo(lch(BASE).C, 2);
    expect(out.h).toBeCloseTo(lch(TOP).h, 1);
    expect(lch(one(hue, 0x808080, BASE)).C).toBeLessThan(0.002);
  });

  it('saturation takes the layer chroma, colorMode its hue and chroma, luminosity its lightness', () => {
    const sat = lch(one(saturation, TOP, BASE));
    expect(sat.C).toBeCloseTo(lch(TOP).C, 2);
    expect(sat.h).toBeCloseTo(lch(BASE).h, 1);
    const col = lch(one(colorMode, TOP, BASE));
    expect(col.L).toBeCloseTo(lch(BASE).L, 2);
    expect(col.h).toBeCloseTo(lch(TOP).h, 1);
    const lum = lch(one(luminosity, TOP, BASE));
    expect(lum.L).toBeCloseTo(lch(TOP).L, 2);
    expect(lum.h).toBeCloseTo(lch(BASE).h, 1);
  });

  it('keep the lightness where the color they make is out of gamut, giving up chroma', () => {
    // Indigo's chroma at its lightness has no room in sRGB at a green or yellow hue.
    const INDIGO = 0x3b5bdb;
    for (const top of [0x0c8f80, 0xc8b400, 0xe0533d]) {
      const out = lch(one(hue, top, INDIGO));
      expect(out.L).toBeCloseTo(lch(INDIGO).L, 2);
      expect(out.h).toBeCloseTo(lch(top).h, 1);
    }
  });

  it('darker and lighter color take one whole color or the other', () => {
    expect(one(darkerColor, 0x2255ee, 0xeeee22)).toBe(0x2255ee);
    expect(one(darkerColor, 0xeeee22, 0x2255ee)).toBe(0x2255ee);
    expect(one(lighterColor, 0x2255ee, 0xeeee22)).toBe(0xeeee22);
  });

  it('give their CSS mode, or normal where CSS has none', () => {
    expect(blendMode(pose(color(hue()), [[TOP, 1]]))).toBe('hue');
    expect(blendMode(pose(color(colorMode()), [[TOP, 1]]))).toBe('color');
    expect(blendMode(pose(color(lighterColor()), [[TOP, 1]]))).toBe('normal');
  });

  it('lay a half-opaque layer halfway', () => {
    const half = toHex(pose(color(luminosity()), [[TOP, 0.5]]), BASE) as number;
    const full = one(luminosity, TOP, BASE);
    for (const s of [16, 8, 0]) {
      const mid = (lin((BASE >> s) & 0xff) + lin((full >> s) & 0xff)) / 2;
      expect(Math.abs(((half >> s) & 0xff) - enc(mid))).toBeLessThanOrEqual(1);
    }
  });
});
