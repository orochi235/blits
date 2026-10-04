import { Player } from '@pg/blits/player';
import { subjectsOf } from '@pg/blits/stage';
import {
  cssColor,
  dotsLayout,
  drawDots,
  drawLetters,
  lettersLayout,
  pickAt,
} from '@pg/blits/stages/draw';
import { describe, expect, it } from 'vitest';

describe('stage draw math', () => {
  it('draws color 0 as the base color and pads others to six hex digits', () => {
    expect(cssColor(0)).toBe('#7aa2ff');
    expect(cssColor(Number.NaN)).toBe('#7aa2ff');
    expect(cssColor(0x00ff08)).toBe('#00ff08');
    expect(cssColor(0, 'rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });
  it('spreads dots corner to corner inside a 40px pad', () => {
    const stage = { cols: 3, rows: 2 };
    expect(dotsLayout(stage, 480, 280, 0)).toMatchObject({ x: 40, y: 40 });
    expect(dotsLayout(stage, 480, 280, 5)).toMatchObject({ x: 440, y: 240 });
  });
  it('centers a lone dot and a lone letter', () => {
    expect(dotsLayout({ cols: 1, rows: 1 }, 200, 100, 0)).toMatchObject({ x: 100, y: 50 });
    expect(lettersLayout(1, 200, 100, 0)).toMatchObject({ x: 100, y: 50 });
  });
  it('picks the nearest subject by base position, and nothing in the gaps', () => {
    const stage = { kind: 'dots', cols: 3, rows: 2 } as const;
    const subjects = subjectsOf(stage);
    expect(pickAt(stage, subjects, 442, 238, 480, 280)).toBe(5);
    expect(pickAt(stage, subjects, 140, 140, 480, 280)).toBeNull();
    const letters = { kind: 'letters', text: 'abc' } as const;
    const ls = subjectsOf(letters);
    const b = lettersLayout(3, 480, 200, 1);
    expect(pickAt(letters, ls, b.x + 3, b.y, 480, 200)).toBe(1);
  });

  it('draws a negative scale as nothing instead of throwing', () => {
    // Stands in for a canvas: arc throws on a negative radius as the real one does.
    const radii: number[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (_, key) =>
        key === 'arc'
          ? (_x: number, _y: number, r: number) => {
              if (r < 0) throw new RangeError('IndexSizeError');
              radii.push(r);
            }
          : () => {},
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const cols = Player.columnsFor(2);
    cols.scale.fill(-1);
    cols.glow.fill(1);
    expect(() => drawDots(ctx, { cols: 2, rows: 1 }, cols, 200, 100, 0)).not.toThrow();
    expect(radii.every((r) => r === 0)).toBe(true);
    const letters = subjectsOf({ kind: 'letters', text: 'ab' });
    expect(() => drawLetters(ctx, letters, cols, 40, 100, 1)).not.toThrow();
  });
});
