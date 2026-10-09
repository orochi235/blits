import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from 'react';
import { hueColor } from '../hue';
import { ClipLane } from './ClipLane';
import { dragEdit, groupDrop, type Handle } from './drag';
import { blockEnd, clipEnd, groupBrackets, laneCount, scaleOf, WIDTH } from './geometry';
import { HeaderLane } from './HeaderLane';
import type { Clip, ClipEdit, Edge, ScoreLanesProps } from './index';
import { activates, nudge } from './keys';
import { Ruler } from './Ruler';
import s from './ScoreLanes.module.css';

const RULER = 24;
const BRACKET_STEP = 5;

type Drag =
  | { clip: Clip; handle: Handle; x0: number }
  | { link: { clip: string; edge: Edge }; x: number; y: number }
  | { scrub: true }
  | { group: string; label: string; x: number; y: number };

export function ScoreLanes(props: ScoreLanesProps) {
  const { clips, links, duration, playhead, selected, onSelect, onEdit, onScrub } = props;
  const laneH = props.laneHeight ?? 36;
  const labelW = props.labelWidth ?? 140;
  const headers = props.headers ?? [];
  const lanes = laneCount(clips, headers);
  const height = RULER + lanes * laneH;
  const scale = useMemo(() => scaleOf(duration, WIDTH, labelW), [duration, labelW]);
  const svg = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^\w-]/g, '');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<ClipEdit | null>(null);

  const local = (e: PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - box.left) / box.width) * WIDTH,
      y: ((e.clientY - box.top) / box.height) * height,
    };
  };
  const shown = (c: Clip): Clip => {
    if (!preview || preview.clip !== c.id) return c;
    if (preview.kind === 'move') return { ...c, start: preview.start };
    if (preview.kind === 'passes') return { ...c, passes: preview.passes };
    if (preview.kind === 'fadeIn') return { ...c, fadeIn: preview.ms };
    if (preview.kind === 'fadeOut') return { ...c, fadeOut: preview.ms };
    return c;
  };
  const scrubTo = (x: number) => {
    const t = scale.t(x);
    if (t >= 0) onScrub(Math.min(duration, t));
  };

  const begin = (e: PointerEvent, clip: Clip, handle: Handle) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    onSelect(clip.id);
    const p = local(e);
    if (e.altKey && (handle === 'body' || handle === 'end'))
      setDrag({
        link: { clip: clip.id, edge: handle === 'end' ? 'end' : 'start' },
        x: p.x,
        y: p.y,
      });
    else setDrag({ clip, handle, x0: p.x });
  };
  const beginScrub = (e: PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ scrub: true });
    scrubTo(local(e).x);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = local(e);
    if ('scrub' in drag) scrubTo(p.x);
    else if ('link' in drag) setDrag({ ...drag, x: p.x, y: p.y });
    else if ('group' in drag) setDrag({ ...drag, x: p.x, y: p.y });
    else setPreview(dragEdit(drag.clip, drag.handle, scale.t(p.x) - scale.t(drag.x0)));
  };
  const onUp = (e: PointerEvent) => {
    if (drag && 'link' in drag) {
      const p = local(e);
      const lane = laneAt(p.y);
      const t = scale.t(p.x);
      const hit = clips.find(
        (c) =>
          c.lane === lane &&
          c.id !== drag.link.clip &&
          t >= c.start &&
          t <= Math.min(clipEnd(c), duration),
      );
      if (hit) {
        const edge: Edge = t - hit.start < Math.min(clipEnd(hit), duration) - t ? 'start' : 'end';
        onEdit({
          clip: drag.link.clip,
          kind: 'link',
          link: { from: drag.link, to: { clip: hit.id, edge } },
        });
      }
    } else if (drag && 'group' in drag) {
      const p = local(e);
      const edit = p.x < labelW ? groupDrop(clips, drag.group, laneAt(p.y)) : null;
      if (edit) onEdit(edit);
    } else if (preview) onEdit(preview);
    reset();
  };
  const reset = () => {
    setDrag(null);
    setPreview(null);
  };
  const laneAt = (y: number) => Math.floor((y - RULER) / laneH);
  const beginGroup = (e: PointerEvent, clip: Clip) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    onSelect(clip.id);
    const p = local(e);
    setDrag({ group: clip.id, label: clip.label, x: p.x, y: p.y });
  };

  const keyEdit = (e: KeyboardEvent, clip: Clip, handle: Handle) => {
    const dt = nudge(e);
    if (dt === null) return;
    const step = handle === 'end' ? Math.sign(dt) * clip.pass : handle === 'fadeOut' ? -dt : dt;
    const edit = dragEdit(clip, handle, step);
    if (edit) onEdit(edit);
  };
  const keyBody = (e: KeyboardEvent, clip: Clip) => {
    if (activates(e)) {
      e.preventDefault();
      onSelect(clip.id);
    } else keyEdit(e, clip, 'body');
  };
  const edgeAt = (id: string, edge: Edge) => {
    const c = clips.find((x) => x.id === id);
    if (!c) return null;
    return {
      x: scale.x(edge === 'start' ? c.start : Math.min(clipEnd(c), duration)),
      y: RULER + c.lane * laneH + laneH / 2,
    };
  };
  const linkDrag = drag && 'link' in drag ? drag : null;
  const linkFrom = linkDrag ? edgeAt(linkDrag.link.clip, linkDrag.link.edge) : null;
  const groupDrag = drag && 'group' in drag ? drag : null;
  const brackets = groupBrackets(clips);
  const depths = Math.max(0, ...brackets.map((b) => b.depth + 1));
  const menuRight = labelW - 4 - depths * BRACKET_STEP;
  const hatchMask = `url(#${uid}-hatch)`;
  const dropLane =
    groupDrag && groupDrag.x < labelW && groupDrop(clips, groupDrag.group, laneAt(groupDrag.y))
      ? laneAt(groupDrag.y)
      : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <svg> cannot be a <fieldset>
    <svg
      ref={svg}
      className={s.score}
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="group"
      aria-label="score"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={reset}
      onPointerDown={() => onSelect(null)}
    >
      <defs>
        <pattern
          id={`${uid}-stripes`}
          width={7}
          height={7}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={3} height={7} fill="#fff" />
        </pattern>
        <mask
          id={`${uid}-hatch`}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={WIDTH}
          height={height}
        >
          <rect width={WIDTH} height={height} fill={`url(#${uid}-stripes)`} />
        </mask>
      </defs>
      <Ruler
        duration={duration}
        playhead={playhead}
        scale={scale}
        labelW={labelW}
        height={RULER}
        onBeginScrub={beginScrub}
        onScrub={onScrub}
      />
      {Array.from({ length: lanes }, (_, i) => (
        <line
          // biome-ignore lint/suspicious/noArrayIndexKey: lanes are positions
          key={i}
          className={s.laneLine}
          x1={0}
          x2={WIDTH}
          y1={RULER + (i + 1) * laneH}
          y2={RULER + (i + 1) * laneH}
        />
      ))}
      {dropLane !== null && (
        <rect className={s.drop} x={0} y={RULER + dropLane * laneH} width={labelW} height={laneH} />
      )}
      {brackets.map((b) => {
        const x = labelW - 4 - b.depth * BRACKET_STEP;
        const y0 = RULER + b.from * laneH + 6;
        const y1 = RULER + (b.to + 1) * laneH - 6;
        return (
          <path
            key={b.group}
            className={s.bracket}
            stroke={hueColor(b.hue)}
            d={`M${x - 4} ${y0} H${x} V${y1} H${x - 4}`}
          />
        );
      })}
      {clips.map((raw) => (
        <ClipLane
          key={raw.id}
          raw={raw}
          clip={shown(raw)}
          clips={clips}
          scale={scale}
          laneTop={RULER + raw.lane * laneH}
          laneH={laneH}
          labelW={labelW}
          menuRight={menuRight}
          duration={duration}
          selected={raw.id === selected}
          hatchMask={hatchMask}
          onBegin={begin}
          onBeginGroup={beginGroup}
          onKeyEdit={keyEdit}
          onKeyBody={keyBody}
          onEdit={onEdit}
        />
      ))}
      {headers.map((h) => (
        <HeaderLane
          key={h.id}
          header={h}
          scale={scale}
          laneTop={RULER + h.lane * laneH}
          laneH={laneH}
          blockBottom={RULER + (blockEnd(h, clips, headers) + 1) * laneH}
          labelW={labelW}
          duration={duration}
          selected={h.id === selected}
          hatchMask={hatchMask}
          onSelect={onSelect}
          onFold={props.onFold}
        />
      ))}
      {links.map((l) => {
        const a = edgeAt(l.from.clip, l.from.edge);
        const b = edgeAt(l.to.clip, l.to.edge);
        if (!a || !b) return null;
        const midY = (a.y + b.y) / 2;
        return (
          <path
            key={`${l.from.clip}.${l.from.edge}-${l.to.clip}.${l.to.edge}`}
            className={s.link}
            d={`M${b.x} ${b.y} C ${b.x} ${midY}, ${a.x} ${midY}, ${a.x} ${a.y}`}
          />
        );
      })}
      {linkDrag && linkFrom && (
        <line className={s.link} x1={linkFrom.x} y1={linkFrom.y} x2={linkDrag.x} y2={linkDrag.y} />
      )}
      {groupDrag && (
        <text className={s.ghost} x={groupDrag.x + 8} y={groupDrag.y + 4}>
          {groupDrag.label}
        </text>
      )}
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
