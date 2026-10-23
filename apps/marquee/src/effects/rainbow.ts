import { oklab, patch } from '@msb235/blits';
import type { Led, Pose } from '../board';
import { layer } from './effect';

/** One OKLab color per whole degree of hue, at full saturation. */
const HUES = Array.from({ length: 360 }, (_, h) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return oklab((f(0) << 16) | (f(8) << 8) | f(4));
});

/** Hue running across the sign. Writes only `tint`, so it recolors whatever else lights a dot. Loops. */
export const rainbow = layer({
  name: 'rainbow',
  about: 'Hue running across the sign; writes only color, so it recolors whatever is lit.',
  on: 'dots',
  // Outweighs the message's own color three to one, so the hue shows through it.
  weight: 3,
  params: {
    period: { label: 'cycle', min: 200, max: 10000, step: 100, value: 2400, unit: 'ms' },
    spread: { label: 'spread', min: 0, max: 45, step: 1, value: 6, unit: '°/col' },
  },
  patch: (_b, p) =>
    patch<Led, Pose>(
      p.period,
      (phase, led) => {
        const h = Math.floor(led.x * p.spread + led.y * p.spread + phase * 360);
        return { tint: HUES[((h % 360) + 360) % 360] as number[] };
      },
      { writes: ['tint'] },
    ),
});
