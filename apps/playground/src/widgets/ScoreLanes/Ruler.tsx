import numeric from '@weasel-js/theme/numeric.module.css';
import type { KeyboardEvent, PointerEvent } from 'react';
import { type Scale, WIDTH } from './geometry';
import { nudge, seconds } from './keys';
import s from './ScoreLanes.module.css';

export interface RulerProps {
  duration: number;
  playhead: number;
  scale: Scale;
  labelW: number;
  height: number;
  onBeginScrub(e: PointerEvent): void;
  onScrub(t: number): void;
}

/** The seconds above the lanes, which scrub the playhead by pointer or by key. */
export function Ruler(p: RulerProps) {
  const { duration, playhead, onScrub } = p;
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onScrub(e.key === 'Home' ? 0 : duration);
      return;
    }
    const dt = nudge(e);
    if (dt !== null) onScrub(Math.min(duration, Math.max(0, playhead + dt)));
  };
  const ticks = Array.from({ length: Math.floor(duration / 1000) + 1 }, (_, i) => i * 1000);
  return (
    <g
      className={s.ruler}
      role="slider"
      tabIndex={0}
      aria-label="playhead"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.round(playhead)}
      aria-valuetext={seconds(playhead)}
      onPointerDown={p.onBeginScrub}
      onKeyDown={key}
    >
      <rect x={p.labelW} y={0} width={WIDTH - p.labelW} height={p.height - 2} />
      {ticks.map((t) => (
        <text key={t} className={numeric.numeric} x={p.scale.x(t) + 3} y={15}>
          {t / 1000}s
        </text>
      ))}
    </g>
  );
}
