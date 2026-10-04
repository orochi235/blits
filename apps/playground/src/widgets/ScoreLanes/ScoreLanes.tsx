import numeric from '@weasel-js/theme/numeric.module.css';
import { MenuButton, type MenuButtonItem } from '@weasel-js/ui';
import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from 'react';
import { dragEdit, fadeRoom, groupDrop, type Handle, hatchOf } from './drag';
import { clipEnd, clipPolygon, groupBrackets, MAX_PASSES, passLines, scaleOf } from './geometry';
import type { Clip, ClipEdit, Edge, Hatch, ScoreLanesProps } from './index';
import s from './ScoreLanes.module.css';

const WIDTH = 1000;
const RULER = 24;

type Drag =
  | { clip: Clip; handle: Handle; x0: number }
  | { link: { clip: string; edge: Edge }; x: number; y: number }
  | { scrub: true }
  | { group: string; label: string; x: number; y: number };

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

/** Arrow keys step 100 ms, 1 s with Shift; null for any other key. */
function nudge(e: KeyboardEvent): number | null {
  const dir =
    e.key === 'ArrowRight' || e.key === 'ArrowUp'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? -1
        : 0;
  if (!dir) return null;
  e.preventDefault();
  return dir * (e.shiftKey ? 1000 : 100);
}

const activates = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ';
const hueFill = (hue: number) => `hsl(${hue} 70% 62%)`;
const fadeMax = (room: number, length: number) => Math.round(Math.min(room, length));

const HATCHES: [Hatch, string][] = [
  ['before', 'Hatch before'],
  ['after', 'Hatch after'],
  ['both', 'Hatch both'],
  [null, 'No hatch'],
];

function menuItems(c: Clip, clips: readonly Clip[]): MenuButtonItem[] {
  const now = hatchOf(c);
  const items: MenuButtonItem[] = HATCHES.map(([h, text]) => ({
    value: `hatch:${h ?? 'none'}`,
    label: h === now ? `✓ ${text}` : text,
    textValue: text,
  }));
  for (const o of clips) {
    if (o.id === c.id || o.lane === c.lane || (c.group !== undefined && o.group === c.group))
      continue;
    items.push({ value: `group:${o.id}`, label: `Group with ${o.label}` });
  }
  items.push({ value: 'leave', label: 'Leave group', isDisabled: c.group === undefined });
  return items;
}

function menuEdit(c: Clip, value: string): ClipEdit | null {
  if (value === 'leave') return { clip: c.id, kind: 'group', with: null };
  if (value.startsWith('group:')) return { clip: c.id, kind: 'group', with: value.slice(6) };
  if (value.startsWith('hatch:')) {
    const h = value.slice(6);
    return { clip: c.id, kind: 'hatch', hatch: h === 'none' ? null : (h as Hatch) };
  }
  return null;
}

export function ScoreLanes(props: ScoreLanesProps) {
  const { clips, links, duration, playhead, selected, onSelect, onEdit, onScrub } = props;
  const laneH = props.laneHeight ?? 36;
  const labelW = props.labelWidth ?? 140;
  const lanes = Math.max(1, ...clips.map((c) => c.lane + 1));
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
  const keyRuler = (e: KeyboardEvent) => {
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onScrub(e.key === 'Home' ? 0 : duration);
      return;
    }
    const dt = nudge(e);
    if (dt !== null) onScrub(Math.min(duration, Math.max(0, playhead + dt)));
  };

  const ticks = Array.from({ length: Math.floor(duration / 1000) + 1 }, (_, i) => i * 1000);
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
      <g
        className={s.ruler}
        role="slider"
        tabIndex={0}
        aria-label="playhead"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(playhead)}
        aria-valuetext={seconds(playhead)}
        onPointerDown={beginScrub}
        onKeyDown={keyRuler}
      >
        <rect x={labelW} y={0} width={WIDTH - labelW} height={RULER - 2} />
        {ticks.map((t) => (
          <text key={t} className={numeric.numeric} x={scale.x(t) + 3} y={15}>
            {t / 1000}s
          </text>
        ))}
      </g>
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
      {groupBrackets(clips).map((b, i) => {
        const x = labelW - 4 - i * 5;
        const y0 = RULER + b.from * laneH + 6;
        const y1 = RULER + (b.to + 1) * laneH - 6;
        return (
          <path
            key={b.group}
            className={s.bracket}
            stroke={hueFill(b.hue)}
            d={`M${x - 4} ${y0} H${x} V${y1} H${x - 4}`}
          />
        );
      })}
      {clips.map((raw) => {
        const c = shown(raw);
        const top = RULER + c.lane * laneH + 4;
        const h = laneH - 12;
        const open = !Number.isFinite(clipEnd(c));
        const end = Math.min(clipEnd(c), duration);
        const length = open ? duration : end - c.start;
        const fill = hueFill(c.hue);
        const classes = [s.clip, c.id === selected && s.selected, c.locked && s.locked];
        return (
          <g key={c.id} className={classes.filter(Boolean).join(' ')}>
            {/* The label drags onto another lane's label to group; the clip menu is its keyboard path. */}
            <text
              className={s.label}
              x={6}
              y={top + h / 2 + 4}
              aria-hidden
              onPointerDown={(e) => beginGroup(e, raw)}
            >
              {c.label}
            </text>
            {c.holdBefore && c.start > 0 && (
              <rect
                className={s.hatch}
                x={labelW}
                y={top}
                width={scale.x(c.start) - labelW}
                height={h}
                fill={fill}
                mask={`url(#${uid}-hatch)`}
              />
            )}
            {/* biome-ignore lint/a11y/useSemanticElements: an SVG shape cannot be a <button> */}
            <polygon
              className={s.body}
              points={clipPolygon(c, scale, top, h, duration)}
              fill={fill}
              role="button"
              tabIndex={0}
              aria-current={c.id === selected ? 'true' : undefined}
              aria-label={`${c.label}, starts ${seconds(c.start)}${c.locked ? ', anchored' : ''}`}
              onPointerDown={(e) => begin(e, raw, 'body')}
              onKeyDown={(e) => keyBody(e, raw)}
            />
            {c.id === selected && (
              <foreignObject x={labelW - 40} y={top - 2} width={26} height={h + 4}>
                {/* Menu presses, portaled or not, must not reach the score's deselect. */}
                <div className={s.menu} onPointerDown={(e) => e.stopPropagation()}>
                  <MenuButton
                    label="⋯"
                    aria-label={`${c.label} menu`}
                    items={menuItems(raw, clips)}
                    onAction={(v) => {
                      const edit = menuEdit(raw, v);
                      if (edit) onEdit(edit);
                    }}
                  />
                </div>
              </foreignObject>
            )}
            {passLines(c, duration).map((t) => (
              <line
                key={t}
                className={s.pass}
                x1={scale.x(t)}
                x2={scale.x(t)}
                y1={top}
                y2={top + h}
              />
            ))}
            {c.spread > 0 && (
              <rect
                className={s.spread}
                x={scale.x(c.start)}
                y={top + h + 2}
                width={scale.x(c.start + c.spread) - scale.x(c.start)}
                height={3}
                fill={fill}
              />
            )}
            {c.holdAfter && !open && end < duration && (
              <rect
                className={s.hatch}
                x={scale.x(end)}
                y={top}
                width={WIDTH - scale.x(end)}
                height={h}
                fill={fill}
                mask={`url(#${uid}-hatch)`}
              />
            )}
            <circle
              className={s.handle}
              cx={scale.x(c.start + c.fadeIn)}
              cy={top}
              r={4}
              role="slider"
              tabIndex={0}
              aria-label={`${c.label} fade in`}
              aria-valuemin={0}
              aria-valuemax={fadeMax(fadeRoom(c, 'fadeIn'), length)}
              aria-valuenow={Math.round(c.fadeIn)}
              aria-valuetext={`${Math.round(c.fadeIn)} ms`}
              onPointerDown={(e) => begin(e, raw, 'fadeIn')}
              onKeyDown={(e) => keyEdit(e, raw, 'fadeIn')}
            />
            {!open && (
              <circle
                className={s.handle}
                cx={scale.x(end - c.fadeOut)}
                cy={top}
                r={4}
                role="slider"
                tabIndex={0}
                aria-label={`${c.label} fade out`}
                aria-valuemin={0}
                aria-valuemax={fadeMax(fadeRoom(c, 'fadeOut'), length)}
                aria-valuenow={Math.round(c.fadeOut)}
                aria-valuetext={`${Math.round(c.fadeOut)} ms`}
                onPointerDown={(e) => begin(e, raw, 'fadeOut')}
                onKeyDown={(e) => keyEdit(e, raw, 'fadeOut')}
              />
            )}
            {!open && c.pass > 0 && (
              <rect
                className={s.edge}
                x={scale.x(end) - 3}
                y={top}
                width={6}
                height={h}
                role="slider"
                tabIndex={0}
                aria-label={`${c.label} passes`}
                aria-valuemin={1}
                aria-valuemax={MAX_PASSES}
                aria-valuenow={c.passes}
                aria-valuetext={`${c.passes} ${c.passes === 1 ? 'pass' : 'passes'}`}
                onPointerDown={(e) => begin(e, raw, 'end')}
                onKeyDown={(e) => keyEdit(e, raw, 'end')}
              />
            )}
            {open && c.pass > 0 && (
              // biome-ignore lint/a11y/useSemanticElements: SVG text cannot be a <button>
              <text
                className={s.arrow}
                x={WIDTH - 16}
                y={top + h / 2 + 5}
                role="button"
                tabIndex={0}
                aria-label={`end ${c.label}'s loop`}
                onPointerDown={(e) => begin(e, raw, 'end')}
                onKeyDown={(e) => {
                  if (!activates(e)) return;
                  e.preventDefault();
                  const edit = dragEdit(raw, 'end', 0);
                  if (edit) onEdit(edit);
                }}
              >
                →
              </text>
            )}
            {open && c.pass <= 0 && (
              <text className={s.arrowStill} x={WIDTH - 16} y={top + h / 2 + 5} aria-hidden>
                →
              </text>
            )}
          </g>
        );
      })}
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
