import { MenuButton, type MenuButtonItem } from '@weasel-js/ui';
import type { KeyboardEvent, PointerEvent } from 'react';
import { hueColor } from '../hue';
import { dragEdit, fadeRoom, type Handle, hatchOf } from './drag';
import {
  clipEnd,
  clipPolygon,
  factorText,
  INDENT,
  MAX_PASSES,
  passLines,
  type Scale,
  WIDTH,
} from './geometry';
import type { Clip, ClipEdit, Hatch } from './index';
import { activates, seconds } from './keys';
import s from './ScoreLanes.module.css';

const MENU_W = 28;
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
    label: (
      <>
        {h === now && <span aria-hidden>✓ </span>}
        {text}
      </>
    ),
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

export interface ClipLaneProps {
  /** The clip as given. */
  raw: Clip;
  /** The clip as shown, a drag's preview applied. */
  clip: Clip;
  clips: readonly Clip[];
  scale: Scale;
  laneTop: number;
  laneH: number;
  labelW: number;
  /** Where the clip menu's button sits, left of the brackets. */
  menuRight: number;
  duration: number;
  selected: boolean;
  hatchMask: string;
  onBegin(e: PointerEvent, clip: Clip, handle: Handle): void;
  onBeginGroup(e: PointerEvent, clip: Clip): void;
  onKeyEdit(e: KeyboardEvent, clip: Clip, handle: Handle): void;
  onKeyBody(e: KeyboardEvent, clip: Clip): void;
  onEdit(edit: ClipEdit): void;
}

/** One clip and its handles, on its lane. */
export function ClipLane(p: ClipLaneProps) {
  const { raw, clip: c, scale, duration, labelW, hatchMask } = p;
  const top = p.laneTop + 4;
  const h = p.laneH - 12;
  const open = !Number.isFinite(clipEnd(c));
  const end = Math.min(clipEnd(c), duration);
  const length = open ? duration : end - c.start;
  const fill = hueColor(c.hue);
  const factor = factorText(c.factor);
  const classes = [s.clip, p.selected && s.selected, c.locked && s.locked];
  return (
    <g className={classes.filter(Boolean).join(' ')}>
      {/* The label drags onto another lane's label to group; the clip menu is its keyboard path. */}
      <text
        className={s.label}
        x={6 + INDENT * (c.depth ?? 0)}
        y={top + h / 2 + 4}
        aria-hidden
        onPointerDown={(e) => p.onBeginGroup(e, raw)}
      >
        {c.label}
        {factor && <tspan className={s.factor}> {factor}</tspan>}
      </text>
      {c.freezeBefore && c.start > 0 && (
        <rect
          className={s.hatch}
          x={labelW}
          y={top}
          width={scale.x(c.start) - labelW}
          height={h}
          fill={fill}
          mask={hatchMask}
        />
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG shape cannot be a <button> */}
      <polygon
        className={c.skipped ? `${s.body} ${s.skipped}` : s.body}
        points={clipPolygon(c, scale, top, h, duration)}
        fill={c.skipped ? undefined : fill}
        stroke={c.skipped ? fill : undefined}
        role="button"
        tabIndex={0}
        aria-current={p.selected ? 'true' : undefined}
        aria-label={`${c.label}${factor && ` at ${factor}`}, starts ${seconds(c.start)}${c.skipped ? ', skipped' : c.locked ? ', anchored' : ''}`}
        onPointerDown={(e) => p.onBegin(e, raw, 'body')}
        onKeyDown={(e) => p.onKeyBody(e, raw)}
      />
      {p.selected && (
        <foreignObject x={p.menuRight - MENU_W} y={top - 2} width={MENU_W - 2} height={h + 4}>
          {/* Menu presses, portaled or not, must not reach the score's deselect. */}
          <div className={s.menu} onPointerDown={(e) => e.stopPropagation()}>
            <MenuButton
              label="⋯"
              aria-label={`${c.label} menu`}
              items={menuItems(raw, p.clips)}
              onAction={(v) => {
                const edit = menuEdit(raw, v);
                if (edit) p.onEdit(edit);
              }}
            />
          </div>
        </foreignObject>
      )}
      {!c.skipped &&
        passLines(c, duration).map((t) => (
          <line key={t} className={s.pass} x1={scale.x(t)} x2={scale.x(t)} y1={top} y2={top + h} />
        ))}
      {c.spread > 0 && (
        <rect
          className={s.spread}
          x={scale.x(c.start + (c.spreadAt ?? 0))}
          y={top + h + 2}
          width={scale.x(c.start + c.spread) - scale.x(c.start)}
          height={3}
          fill={fill}
        />
      )}
      {c.freezeAfter && !open && end < duration && (
        <rect
          className={s.hatch}
          x={scale.x(end)}
          y={top}
          width={WIDTH - scale.x(end)}
          height={h}
          fill={fill}
          mask={hatchMask}
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
        onPointerDown={(e) => p.onBegin(e, raw, 'fadeIn')}
        onKeyDown={(e) => p.onKeyEdit(e, raw, 'fadeIn')}
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
          onPointerDown={(e) => p.onBegin(e, raw, 'fadeOut')}
          onKeyDown={(e) => p.onKeyEdit(e, raw, 'fadeOut')}
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
          onPointerDown={(e) => p.onBegin(e, raw, 'end')}
          onKeyDown={(e) => p.onKeyEdit(e, raw, 'end')}
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
          onPointerDown={(e) => p.onBegin(e, raw, 'end')}
          onKeyDown={(e) => {
            if (!activates(e)) return;
            e.preventDefault();
            const edit = dragEdit(raw, 'end', 0);
            if (edit) p.onEdit(edit);
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
}
