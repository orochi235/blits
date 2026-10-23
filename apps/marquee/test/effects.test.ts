import { describe, expect, it } from 'vitest';
import { board, type Led, leftOf, SIZE } from '../src/board';
import {
  type Effect,
  fall,
  flip,
  LAYERS,
  rainbow,
  roll,
  TEXT,
  type TextEffect,
  tile,
  values,
} from '../src/effects';
import { turnAt } from '../src/effects/flip';
import { ROWS, rasterize } from '../src/font';

const b = board(SIZE.cols, SIZE.rows);
const dot = (x: number, y: number) => b.dots[y * b.cols + x] as Led;
const setting = {} as never;
const text = rasterize('AB');
const left = leftOf(b, text);

/** The sign's lit dots over the text's columns, as rows of `#` and `.`. */
function shown(at: (led: Led) => number | undefined): string[] {
  return Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: text.cols }, (_, x) => (at(dot(left + x, y)) ? '#' : '.')).join(''),
  );
}
const upright = shown((led) => (text.lit(led.x - left, led.y) ? 1 : 0));
/** A text effect's lit dots `t` ms into its pass, at its defaults. */
const run = (e: TextEffect) => {
  const { patch, ms } = e.stage(b, text, 0xff9a2e, values(e));
  return { ms, at: (t: number) => shown((led) => patch.at(t / patch.duration, led, setting).lit) };
};

describe('every effect', () => {
  const all: Effect[] = [...Object.values(TEXT), ...Object.values(LAYERS)];

  it('declares defaults inside its own ranges', () => {
    for (const e of all)
      for (const [key, p] of Object.entries(e.params)) {
        expect(p.value, `${e.name}.${key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.value, `${e.name}.${key}`).toBeLessThanOrEqual(p.max);
      }
  });

  it('builds at its extremes', () => {
    const big = board(40, 24);
    for (const e of all)
      for (const end of ['min', 'max'] as const) {
        const p = Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, v[end]]));
        const patch = e.kind === 'text' ? e.stage(big, text, 0xffffff, p).patch : e.patch(big, p);
        expect(Number.isFinite(patch.duration), `${e.name} at ${end}`).toBe(true);
      }
  });
});

describe('flip', () => {
  const { at, ms } = run(flip);

  it('stands upright between turns, and upside down a quarter of the way through its tumbles', () => {
    expect(turnAt(600, 3600, 2)).toBe(0);
    expect(at(600)).toEqual(upright);
    expect(turnAt(1500, 3600, 2)).toBeCloseTo(Math.PI);
    expect(at(1500)).toEqual([...upright].reverse());
  });

  it('is a line across the middle edge on, and dark once folded away', () => {
    const edge = at(1350);
    expect(edge.filter((r) => r.includes('#'))).toHaveLength(1);
    expect(edge[3]).toContain('#');
    expect(at(3590).join('')).not.toContain('#');
    expect(ms).toBe(3600 + 90);
  });
});

describe('roll', () => {
  const { at, ms } = run(roll);

  it('lands every letter on its own glyph, then rolls them away', () => {
    expect(at(ms - 900)).toEqual(upright);
    expect(at(ms - 1).join('')).not.toContain('#');
  });
});

describe('fall', () => {
  const { at, ms } = run(fall);

  it('starts dark, stands whole between dropping in and falling out, and ends dark', () => {
    expect(at(0).join('')).not.toContain('#');
    expect(at(2000)).toEqual(upright);
    expect(at(ms - 1).join('')).not.toContain('#');
  });
});

describe('tile', () => {
  it('plays only where two lines fit', () => {
    expect(tile.fits?.(b)).toBe(false);
    expect(tile.fits?.(board(40, 24))).toBe(true);
  });

  it('scrolls neighboring rows opposite ways', () => {
    const big = board(40, 24);
    const p = values(tile, { angle: 0 });
    const { patch } = tile.stage(big, text, 0xffffff, p);
    const lit = (x: number, y: number, t: number) =>
      patch.at(t / patch.duration, big.dots[y * 40 + x] as Led, setting).lit;
    const moved = (y: number, by: number) =>
      Array.from(
        { length: 30 },
        (_, i) => lit(i + 5, y, 1000 + p.step) === lit(i + 5 + by, y, 1000),
      );
    // Row 0 starts at the board's middle, y 12; row -1 is the one above it.
    expect(moved(14, 1).every(Boolean)).toBe(true);
    expect(moved(5, -1).every(Boolean)).toBe(true);
  });
});

describe('rainbow', () => {
  it('writes only color', () => {
    const pose = rainbow.patch(b, values(rainbow)).at(0.25, dot(10, 3) as never, setting);
    expect(Object.keys(pose)).toEqual(['tint']);
  });
});
