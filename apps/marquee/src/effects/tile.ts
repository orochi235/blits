import { oklab, patch } from '@msb235/blits';
import type { Led, Pose } from '../board';
import { ROWS } from '../font';
import { textEffect } from './effect';

/**
 * The message repeated over the whole sign in rows laid like bricks, tilted, each row scrolling the
 * other way from its neighbors.
 */
export const tile = textEffect({
  name: 'tile',
  about: 'Repeats the message in tilted brick rows, neighbors scrolling opposite ways.',
  params: {
    ms: { label: 'length', min: 2000, max: 20000, step: 500, value: 9000, unit: 'ms' },
    angle: { label: 'tilt', min: -60, max: 60, step: 1, value: 30, unit: '°' },
    step: { label: 'column time', min: 10, max: 300, step: 5, value: 60, unit: 'ms' },
    gap: { label: 'gap', min: 0, max: 30, step: 1, value: 6, unit: 'cols' },
    leading: { label: 'row gap', min: 1, max: 6, step: 1, value: 2, unit: 'rows' },
    brick: { label: 'brick offset', min: 0, max: 1, step: 0.05, value: 0.5 },
  },
  fits: (b) => b.lines > 1,
  stage(b, text, hex, p) {
    const tint = oklab(hex);
    const period = text.cols + p.gap;
    const pitch = ROWS + p.leading;
    const a = (p.angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const cx = b.cols / 2;
    const cy = b.rows / 2;
    return {
      patch: patch<Led, Pose>(
        p.ms,
        (phase, led) => {
          if (phase > 0.995) return { lit: 0, tint };
          const dx = led.x - cx;
          const dy = led.y - cy;
          // Along the rows rises to the right; across them points down the sign.
          const along = dx * c - dy * s;
          const across = dx * s + dy * c;
          const r = Math.floor(across / pitch);
          const y = Math.floor(across - r * pitch);
          if (y >= ROWS) return { lit: 0, tint };
          const odd = r % 2 !== 0;
          const moved = (phase * p.ms) / p.step;
          const col = Math.floor(along + (odd ? p.brick * period - moved : moved));
          const x = ((col % period) + period) % period;
          return { lit: text.lit(x, y) ? 1 : 0, tint };
        },
        { writes: ['lit', 'tint'] },
      ),
      ms: p.ms,
    };
  },
});
