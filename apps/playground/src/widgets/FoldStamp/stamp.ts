import type { NumberRule } from '@pg/blits/kit';
import { stampCurves } from './curves';

/** How the curves are drawn: thin and many, bold and few, or bold with overlaps adding light and a glow. */
export type StampLine = 'fine' | 'bold' | 'glowing';
/** What tells one voice value's curve from another's besides its place. */
export type StampEncoding = 'none' | 'hue' | 'opacity' | 'both';
/** The hues a voice value runs through, low to high. */
export type StampRamp = 'cool' | 'warm';

export interface StampOptions {
  rule: NumberRule;
  /** Side, in px. Default 128. */
  size?: number;
  /** The voices' weight, 0 to 1: at 0 every curve is the fold passed through unchanged. Default 1. */
  weight?: number;
  line?: StampLine;
  encode?: StampEncoding;
  ramp?: StampRamp;
}

/** What a glowing stamp is drawn on. */
export const STAMP_BG = '#070c10';

const LINES: Record<
  StampLine,
  { count: number; width: number; opacity: number; ink: string; bg: string }
> = {
  fine: { count: 28, width: 1.5, opacity: 0.22, ink: '#7fc8ff', bg: '#16222c' },
  bold: { count: 16, width: 1.75, opacity: 0.55, ink: '#a8dcff', bg: '#16222c' },
  glowing: { count: 22, width: 1.75, opacity: 0.6, ink: '#7ad0ff', bg: STAMP_BG },
};

const RAMPS: Record<StampRamp, (t: number) => string> = {
  cool: (t) => `hsl(${205 + t * 115} 95% 66%)`,
  warm: (t) => `hsl(${190 - t * 155} 95% 62%)`,
};

/** The hues a value runs through, low to high, in `ramp`. */
export const rampOf = (ramp: StampRamp) => RAMPS[ramp];

const PAD = 10 / 128;
const RADIUS = 10 / 128;

/** A stamp of `rule` as a standalone SVG document: one curve per voice value, the output against
 *  what the fold holds so far, drawn through the kit's own channel. */
export function stampSvg({
  rule,
  size = 128,
  weight = 1,
  line = 'glowing',
  encode = 'hue',
  ramp = 'cool',
}: StampOptions): string {
  const look = LINES[line];
  const hue = encode === 'hue' || encode === 'both';
  const fade = encode === 'opacity' || encode === 'both';
  const at = (u: number) => (PAD + u * (1 - 2 * PAD)) * size;
  const paths = stampCurves(rule, look.count, weight)
    .map((c) => {
      const d = c.runs
        .map((run) =>
          run
            .map(([x, y], i) => `${i ? 'L' : 'M'}${at(x).toFixed(1)} ${(size - at(y)).toFixed(1)}`)
            .join(''),
        )
        .join('');
      const stroke = hue ? RAMPS[ramp](c.t) : look.ink;
      const opacity = fade ? 0.12 + c.t * 0.78 : look.opacity;
      return `<path d="${d}" stroke="${stroke}" stroke-opacity="${opacity.toFixed(2)}"/>`;
    })
    .join('');
  const glowing = line === 'glowing';
  // Overlapping curves add light, so where they crowd the stamp burns toward white.
  const blend = glowing ? ' style="mix-blend-mode:plus-lighter"' : '';
  const lines = `<g${blend}>${paths}</g>`;
  const halo = glowing
    ? `<filter id="g" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${(1.4 * size) / 128}"/></filter><g filter="url(#g)">${lines}</g>`
    : '';
  const r = RADIUS * size;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<clipPath id="c"><rect width="${size}" height="${size}" rx="${r}"/></clipPath>` +
    `<g clip-path="url(#c)"><rect width="${size}" height="${size}" fill="${look.bg}"/>` +
    `<g fill="none" stroke-width="${look.width * Math.max(size / 128, 0.75)}" stroke-linecap="round" stroke-linejoin="round" style="isolation:isolate">` +
    `${halo}${lines}</g></g></svg>`
  );
}

/** `stampSvg` as a URL an image can load. */
export const stampUrl = (options: StampOptions) =>
  `data:image/svg+xml,${encodeURIComponent(stampSvg(options))}`;
