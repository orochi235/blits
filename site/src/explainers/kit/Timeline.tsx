import { area, curve, spread, stops } from '@pg/widgets/ScoreLanes/track';
import { type PointerEvent, useEffect, useId, useMemo, useRef } from 'react';

/** How far an arrow key moves the time; Shift moves four times as far. */
const STEP_MS = 250;

export interface Track {
  name: string;
  color: string;
  /** When each sample was taken, ms into the run; every list below is at these. */
  at: number[];
  /** The voice's weight at those times, 0..1. */
  weights: number[];
  /** The channel drawn as a line over the weight, and its values at the same times. */
  channel?: string;
  values?: number[];
  /** For a voice that moves only a color: the band is that color over time, as CSS. */
  colors?: string[];
}

/**
 * The run's time as one track per voice, each drawn by its weight and colored up to the playhead.
 * A press seeks there and follows a drag; the arrow keys, Home and End move it from the keyboard.
 */
export function Timeline({
  open = true,
  duration,
  t,
  tracks,
  seek,
}: {
  /** Closed, the tracks shrink to a thin strip that still scrubs. */
  open?: boolean;
  duration: number;
  t: number;
  tracks: Track[];
  /** Moves the time to what `to` makes of the time as it stands. */
  seek(to: (t: number) => number): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const held = useRef(false);
  const paths = useMemo(
    () =>
      tracks.map((tr) => ({
        area: area(tr.weights, tr.at, duration, 0.1),
        line: tr.values ? curve(spread(tr.values), tr.at, duration) : '',
      })),
    [tracks, duration],
  );
  const id = useId();

  useEffect(() => {
    box.current?.style.setProperty('--at', (duration > 0 ? t / duration : 0).toFixed(5));
  }, [t, duration]);

  const msAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) || 0) * duration;
  };

  return (
    <div
      ref={box}
      className={open ? 'timeline' : 'timeline closed'}
      role="slider"
      tabIndex={0}
      aria-label="Time"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.round(t)}
      aria-valuetext={`${(t / 1000).toFixed(2)} s`}
      onKeyDown={(e) => {
        const by = { ArrowLeft: -STEP_MS, ArrowRight: STEP_MS }[e.key];
        const clamp = (v: number) => Math.min(duration, Math.max(0, v));
        let to: ((now: number) => number) | undefined;
        if (by !== undefined) to = (now) => clamp(now + by * (e.shiftKey ? 4 : 1));
        else if (e.key === 'Home') to = () => 0;
        else if (e.key === 'End') to = () => duration;
        if (to === undefined) return;
        e.preventDefault();
        seek(to);
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        held.current = true;
        const ms = msAt(e);
        seek(() => ms);
      }}
      onPointerMove={(e) => {
        if (!held.current) return;
        const ms = msAt(e);
        seek(() => ms);
      }}
      onPointerUp={() => {
        held.current = false;
      }}
      onPointerCancel={() => {
        held.current = false;
      }}
    >
      {tracks.map((tr, i) => {
        const band = tr.colors && `${id}-band-${i}`;
        const layers = (
          <>
            {band && <rect className="timeline-band" width={1} height={1} fill={`url(#${band})`} />}
            <path className="timeline-area" d={paths[i]?.area} />
            <path className="timeline-curve" d={paths[i]?.line} />
          </>
        );
        return (
          <div key={tr.name} className="timeline-track" data-color={tr.color}>
            <svg
              className="timeline-ahead"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {band && tr.colors && (
                <defs>
                  <linearGradient id={band}>
                    {stops(tr.colors, tr.at, duration).map((s) => (
                      <stop key={s.at} offset={s.at} stopColor={s.color} />
                    ))}
                  </linearGradient>
                </defs>
              )}
              {layers}
            </svg>
            <svg
              className="timeline-played"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {layers}
            </svg>
            <span className="timeline-name">
              {tr.name}
              {tr.channel && <span className="timeline-channel"> {tr.channel}</span>}
            </span>
          </div>
        );
      })}
      <span className="timeline-head" aria-hidden="true" />
    </div>
  );
}
