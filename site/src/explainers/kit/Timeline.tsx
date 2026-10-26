import { type PointerEvent, useEffect, useMemo, useRef } from 'react';

/** How far an arrow key moves the time; Shift moves four times as far. */
const STEP_MS = 250;

export interface Track {
  name: string;
  color: string;
  /** The voice's weight at evenly spaced times across the run, 0..1. */
  weights: number[];
  /** The channel drawn as a line over the weight, and its values at the same times. */
  channel?: string;
  values?: number[];
}

/** `values` stretched to fill 0..1 from their lowest to their highest. */
function spread(values: number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5));
}

/** A weight curve, in a box `n - 1` wide and 1 tall. */
function curve(weights: number[]): string {
  const top = weights.map(
    (w, k) =>
      `${k === 0 ? 'M' : 'L'}${k},${(1 - Math.min(1, Math.max(0, w)) * 0.8 - 0.1).toFixed(3)}`,
  );
  return top.join(' ');
}

/** The area under a weight curve. */
function area(weights: number[]): string {
  const n = weights.length;
  if (n === 0) return '';
  return `${curve(weights)} L${n - 1},1 L0,1 Z`;
}

/**
 * The run's time as one track per voice, each drawn by its weight and colored up to the playhead.
 * A press seeks there and follows a drag; the arrow keys, Home and End move it from the keyboard.
 */
export function Timeline({
  duration,
  t,
  tracks,
  seek,
}: {
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
        area: area(tr.weights),
        line: tr.values ? curve(spread(tr.values)) : '',
      })),
    [tracks],
  );
  const width = Math.max(1, (tracks[0]?.weights.length ?? 2) - 1);

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
      className="timeline"
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
      {tracks.map((tr, i) => (
        <div key={tr.name} className="timeline-track" data-color={tr.color}>
          <svg
            className="timeline-ahead"
            viewBox={`0 0 ${width} 1`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path className="timeline-area" d={paths[i]?.area} />
            <path className="timeline-curve" d={paths[i]?.line} />
          </svg>
          <svg
            className="timeline-played"
            viewBox={`0 0 ${width} 1`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path className="timeline-area" d={paths[i]?.area} />
            <path className="timeline-curve" d={paths[i]?.line} />
          </svg>
          <span className="timeline-name">
            {tr.name}
            {tr.channel && <span className="timeline-channel"> {tr.channel}</span>}
          </span>
        </div>
      ))}
      <span className="timeline-head" aria-hidden="true" />
    </div>
  );
}
