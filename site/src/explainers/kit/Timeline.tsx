import { type PointerEvent, useEffect, useMemo, useRef } from 'react';

/** How far an arrow key moves the time; Shift moves four times as far. */
const STEP_MS = 250;

export interface Track {
  name: string;
  color: string;
  /** The voice's weight at evenly spaced times across the run, 0..1. */
  weights: number[];
}

/** An area under a weight curve, in a box `n - 1` wide and 1 tall. */
function area(weights: number[]): string {
  const n = weights.length;
  if (n === 0) return '';
  const top = weights.map((w, k) => `L${k},${(1 - Math.min(1, Math.max(0, w)) * 0.9).toFixed(3)}`);
  return `M0,1 ${top.join(' ')} L${n - 1},1 Z`;
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
  const paths = useMemo(() => tracks.map((tr) => area(tr.weights)), [tracks]);
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
          <svg viewBox={`0 0 ${width} 1`} preserveAspectRatio="none" aria-hidden="true">
            <path className="timeline-ahead" d={paths[i]} />
          </svg>
          <svg
            className="timeline-played"
            viewBox={`0 0 ${width} 1`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={paths[i]} />
          </svg>
          <span className="timeline-name">{tr.name}</span>
        </div>
      ))}
      <span className="timeline-head" aria-hidden="true" />
    </div>
  );
}
