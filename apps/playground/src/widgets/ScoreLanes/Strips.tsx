import { hueColor } from '@msb235/blits-panel';
import { type PointerEvent, useId, useMemo, useRef } from 'react';
import { clipPolygon, laneCount, RULER, scaleOf, WIDTH } from './geometry';
import type { ScoreLanesProps } from './index';
import { Ruler } from './Ruler';
import s from './ScoreLanes.module.css';
import { TrackLayers } from './TrackLayers';

const STRIP = 5;
const PITCH = STRIP + 2;

/** The score with its lanes closed: a thin strip per lane, in its track's look, that scrubs. */
export function Strips(props: ScoreLanesProps) {
  const { clips, duration, playhead, onScrub } = props;
  const headers = props.headers ?? [];
  const labelW = props.labelWidth ?? 140;
  const height = RULER + laneCount(clips, headers) * PITCH;
  const scale = useMemo(() => scaleOf(duration, WIDTH, labelW), [duration, labelW]);
  const svg = useRef<SVGSVGElement>(null);
  const held = useRef(false);
  const played = `${useId().replace(/[^\w-]/g, '')}-played`;
  const scrub = (e: PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const t = scale.t(((e.clientX - box.left) / box.width) * WIDTH);
    onScrub(Math.min(duration, Math.max(0, t)));
  };
  const rows = [
    ...clips.map((c) => ({ id: c.id, lane: c.lane, hue: c.hue, clip: c })),
    ...headers.map((h) => ({ id: h.id, lane: h.lane, hue: h.hue, clip: undefined })),
  ];
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <svg> cannot be a <fieldset>
    <svg
      ref={svg}
      className={`${s.score} ${s.strips}`}
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="group"
      aria-label="score"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        held.current = true;
        scrub(e);
      }}
      onPointerMove={(e) => held.current && scrub(e)}
      onPointerUp={() => {
        held.current = false;
      }}
      onPointerCancel={() => {
        held.current = false;
      }}
    >
      <defs>
        <clipPath id={played}>
          <rect width={Math.max(0, scale.x(Math.min(playhead, duration)))} height={height} />
        </clipPath>
      </defs>
      <Ruler
        duration={duration}
        playhead={playhead}
        scale={scale}
        labelW={labelW}
        height={RULER}
        onBeginScrub={() => {}}
        onScrub={onScrub}
      />
      {rows.map((r) => {
        const y = RULER + r.lane * PITCH;
        return (
          <TrackLayers
            key={r.id}
            track={props.tracks?.get(r.id)}
            color={hueColor(r.hue)}
            x={labelW}
            w={WIDTH - labelW}
            band={{ y, h: STRIP }}
            box={{ y, h: STRIP }}
            fallback={r.clip && clipPolygon(r.clip, scale, y, STRIP, duration)}
            played={`url(#${played})`}
          />
        );
      })}
      <line
        className={s.playhead}
        x1={scale.x(playhead)}
        x2={scale.x(playhead)}
        y1={0}
        y2={height}
      />
    </svg>
  );
}
