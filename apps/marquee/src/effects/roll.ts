import { oklab, patch } from '@msb235/blits';
import { type Led, leftOf, type Pose } from '../board';
import { ADVANCE, type Bitmap, FACE, ROWS, rasterize } from '../font';
import { rowOf, textEffect } from './effect';
import { hash } from './hash';

/** A reel's pitch: a glyph and the blank row under it. */
const REEL = ROWS + 1;
const AWAY_MS = 500;
const glyphs = new Map<string, Bitmap>();
const glyph = (ch: string) => {
  let g = glyphs.get(ch);
  if (g === undefined) {
    g = rasterize(ch);
    glyphs.set(ch, g);
  }
  return g;
};
const easeOut = (u: number) => 1 - (1 - u) ** 3;

/**
 * Each letter a reel spinning through random glyphs and slowing onto its own, the later ones
 * spinning longer, then all of them rolling up and away.
 */
export const roll = textEffect({
  name: 'roll',
  about: 'Each letter spins through random glyphs like a slot reel, landing left to right.',
  params: {
    spin: { label: 'first spin', min: 200, max: 3000, step: 50, value: 900, unit: 'ms' },
    lag: { label: 'letter lag', min: 0, max: 500, step: 10, value: 140, unit: 'ms' },
    show: { label: 'stand', min: 0, max: 6000, step: 100, value: 1800, unit: 'ms' },
    glyphs: { label: 'glyphs passed', min: 1, max: 30, step: 1, value: 6 },
  },
  stage(b, text, hex, p) {
    const tint = oklab(hex);
    const left = leftOf(b, text);
    const n = text.cols / ADVANCE;
    const reels = Array.from({ length: n }, (_, k) =>
      Array.from({ length: p.glyphs + 2 * k }, (_, j) =>
        glyph(FACE[Math.floor(hash(k, j, text.cols) * FACE.length)] as string),
      ),
    );
    const landed = p.spin + (n - 1) * p.lag;
    const ms = landed + p.show + AWAY_MS;
    return {
      patch: patch<Led, Pose>(
        ms,
        (phase, led) => {
          const row = rowOf(led);
          const x = led.x - left;
          const k = Math.floor(x / ADVANCE);
          if (row < 0 || k < 0 || k >= n) return { lit: 0, tint };
          const t = phase * ms;
          const reel = reels[k] as Bitmap[];
          const spun = REEL * reel.length * easeOut(Math.min(1, t / (p.spin + k * p.lag)));
          const away = REEL * 2 * Math.max(0, (t - landed - p.show) / AWAY_MS) ** 2;
          const r = row + Math.floor(spun + away);
          const j = Math.floor(r / REEL);
          const y = r % REEL;
          const on =
            y < ROWS &&
            (j < reel.length
              ? (reel[j] as Bitmap).lit(x - k * ADVANCE, y)
              : j === reel.length && text.lit(x, y));
          return { lit: on ? 1 : 0, tint };
        },
        { writes: ['lit', 'tint'] },
      ),
      ms,
    };
  },
});
