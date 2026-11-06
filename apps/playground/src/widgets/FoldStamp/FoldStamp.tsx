import type { NumberRule } from '@pg/blits/kit';
import { useId, useMemo } from 'react';
import { stampCurves } from './curves';
import css from './FoldStamp.module.css';

/** How the curves are drawn: thin and many, bold and few, or bold with overlaps adding light and a glow. */
export type StampLine = 'fine' | 'bold' | 'glowing';
/** What tells one voice value's curve from another's besides its place. */
export type StampEncoding = 'none' | 'hue' | 'opacity' | 'both';
/** The hues a voice value runs through, low to high. */
export type StampRamp = 'cool' | 'warm';

export interface FoldStampProps {
  rule: NumberRule;
  /** Side, in px. Default 128. */
  size?: number;
  /** The voices' weight, 0 to 1: at 0 every curve is the fold passed through unchanged. Default 1. */
  weight?: number;
  line?: StampLine;
  encode?: StampEncoding;
  ramp?: StampRamp;
}

const LINES: Record<StampLine, { count: number; width: number; opacity: number; ink: string }> = {
  fine: { count: 28, width: 1.5, opacity: 0.22, ink: '#7fc8ff' },
  bold: { count: 16, width: 1.75, opacity: 0.55, ink: '#a8dcff' },
  glowing: { count: 22, width: 1.75, opacity: 0.6, ink: '#7ad0ff' },
};

const RAMPS: Record<StampRamp, (t: number) => string> = {
  cool: (t) => `hsl(${205 + t * 115} 95% 66%)`,
  warm: (t) => `hsl(${190 - t * 155} 95% 62%)`,
};

const PAD = 10 / 128;

export function FoldStamp({
  rule,
  size = 128,
  weight = 1,
  line = 'glowing',
  encode = 'hue',
  ramp = 'cool',
}: FoldStampProps) {
  const id = useId();
  const look = LINES[line];
  const curves = useMemo(() => stampCurves(rule, look.count, weight), [rule, look.count, weight]);
  const hue = encode === 'hue' || encode === 'both';
  const fade = encode === 'opacity' || encode === 'both';
  const at = (u: number) => (PAD + u * (1 - 2 * PAD)) * size;
  const paths = curves.map((c) => (
    <path
      key={c.t}
      d={c.runs
        .map((run) =>
          run
            .map(([x, y], i) => `${i ? 'L' : 'M'}${at(x).toFixed(1)} ${(size - at(y)).toFixed(1)}`)
            .join(''),
        )
        .join('')}
      stroke={hue ? RAMPS[ramp](c.t) : look.ink}
      strokeOpacity={fade ? 0.12 + c.t * 0.78 : look.opacity}
    />
  ));
  const glowing = line === 'glowing';
  return (
    <svg
      className={`${css.stamp} ${css[line]}`}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`${rule} at weight ${weight}`}
    >
      {glowing && (
        <filter id={`${id}glow`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={1.4 * (size / 128)} />
        </filter>
      )}
      <g className={css.lines} strokeWidth={look.width * Math.max(size / 128, 0.75)}>
        {glowing && <g filter={`url(#${id}glow)`}>{paths}</g>}
        {paths}
      </g>
    </svg>
  );
}
