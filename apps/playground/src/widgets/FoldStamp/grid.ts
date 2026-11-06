import { rampOf, STAMP_BG } from './stamp';

export interface GridStampOptions {
  cols: number;
  rows: number;
  /** One per cell, row by row; NaN draws an empty ring. */
  values: readonly number[];
  /** Width, in px. Default 128. */
  size?: number;
}

const PAD = 6 / 128;
/** The flattest a grid stamp gets, height over width, so a one-row stage still reads as a strip. */
const FLATTEST = 0.3;

/** A grid stamp's height for `size` wide: the stage's own proportions, no flatter than a strip. */
export const gridHeight = (cols: number, rows: number, size: number) =>
  Math.round(size * Math.min(1, Math.max(FLATTEST, rows / cols)));

/** A stage as a standalone SVG document: a dot per subject in its place, shaded by its value from
 *  the lowest to the highest in the stamps' ramp, glowing as the fold stamps do. */
export function gridSvg({ cols, rows, values, size = 128 }: GridStampOptions): string {
  const w = size;
  const h = gridHeight(cols, rows, size);
  const known = values.filter(Number.isFinite);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const pad = PAD * size;
  const pitch = Math.min((w - 2 * pad) / cols, (h - 2 * pad) / rows);
  const r = pitch * 0.38;
  const x0 = (w - pitch * cols) / 2 + pitch / 2;
  const y0 = (h - pitch * rows) / 2 + pitch / 2;
  const ramp = rampOf('cool');
  const dots = values
    .map((v, i) => {
      const cx = (x0 + (i % cols) * pitch).toFixed(1);
      const cy = (y0 + Math.floor(i / cols) * pitch).toFixed(1);
      if (!Number.isFinite(v))
        return `<circle cx="${cx}" cy="${cy}" r="${(r * 0.8).toFixed(1)}" fill="none" stroke="#45596a"/>`;
      const t = hi > lo ? (v - lo) / (hi - lo) : 0;
      return `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${ramp(t)}"/>`;
    })
    .join('');
  const radius = (8 / 128) * size;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<filter id="g" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${(1.2 * size) / 128}"/></filter>` +
    `<rect width="${w}" height="${h}" rx="${radius}" fill="${STAMP_BG}"/>` +
    `<g filter="url(#g)">${dots}</g>${dots}</svg>`
  );
}

export const gridUrl = (options: GridStampOptions) =>
  `data:image/svg+xml,${encodeURIComponent(gridSvg(options))}`;
