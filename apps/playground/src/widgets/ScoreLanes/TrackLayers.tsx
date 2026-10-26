import { useId, useMemo } from 'react';
import type { Track } from './index';
import s from './ScoreLanes.module.css';
import { area, curve, spread, stops } from './track';

export interface TrackLayersProps {
  track: Track | undefined;
  color: string;
  /** The time axis's left edge and width. */
  x: number;
  w: number;
  /** The lane's band. */
  band: { y: number; h: number };
  /** Where the weight fills, full at weight 1. */
  box: { y: number; h: number };
  /** Drawn as the weight where there is no track: the clip's own outline. */
  fallback?: string;
  /** A clip path showing only what the playhead has passed. */
  played: string;
}

/**
 * A lane's band in its color, its weight as an area, and the channel it moves most as a line, or a
 * color-only voice's colors as a gradient; fainter ahead of the playhead than behind it.
 */
export function TrackLayers(p: TrackLayersProps) {
  const { track, color } = p;
  const grad = useId().replace(/[^\w-]/g, '');
  const paths = useMemo(
    () =>
      track && {
        area: area(track.weights),
        line: track.values ? curve(spread(track.values)) : '',
      },
    [track],
  );
  const n = Math.max(1, (track?.weights.length ?? 2) - 1);
  const layers = (
    <>
      {track?.colors && (
        <rect className={s.trackColors} width={n} height={1} fill={`url(#${grad})`} />
      )}
      {paths && <path className={s.trackArea} d={paths.area} fill={color} />}
      {paths?.line && <path className={s.trackCurve} d={paths.line} stroke={color} />}
    </>
  );
  const box = (className: string | undefined, defs?: boolean) => (
    <svg
      className={className}
      x={p.x}
      y={p.box.y}
      width={p.w}
      height={Math.max(0, p.box.h)}
      viewBox={`0 0 ${n} 1`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {defs && track?.colors && (
        <defs>
          <linearGradient id={grad}>
            {stops(track.colors).map((x) => (
              <stop key={x.at} offset={x.at} stopColor={x.color} />
            ))}
          </linearGradient>
        </defs>
      )}
      {layers}
    </svg>
  );
  const outline = !track && p.fallback !== undefined;
  return (
    <g className={s.track} aria-hidden>
      <rect
        className={s.trackBand}
        x={p.x}
        y={p.band.y}
        width={p.w}
        height={p.band.h}
        fill={color}
      />
      {box(s.ahead, true)}
      {outline && <polygon className={s.trackArea} points={p.fallback} fill={color} />}
      <g clipPath={p.played} className={s.played}>
        {box(undefined)}
        {outline && <polygon className={s.trackArea} points={p.fallback} fill={color} />}
      </g>
    </g>
  );
}
