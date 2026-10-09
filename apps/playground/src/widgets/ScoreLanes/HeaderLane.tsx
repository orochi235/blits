import type { KeyboardEvent, PointerEvent } from 'react';
import { hueColor } from '../hue';
import { INDENT, type Scale, WIDTH } from './geometry';
import type { Header } from './index';
import { activates, seconds } from './keys';
import s from './ScoreLanes.module.css';

const BAR_H = 8;
const BAR_MIN_W = 4;
const FOLD_W = 14;

export interface HeaderLaneProps {
  header: Header;
  scale: Scale;
  laneTop: number;
  laneH: number;
  /** The bottom of the last lane its block holds. */
  blockBottom: number;
  labelW: number;
  duration: number;
  selected: boolean;
  hatchMask: string;
  onSelect(id: string): void;
  onFold?(id: string, folded: boolean): void;
}

/** A group's lane: its fold button and label, a bar over its extent, and a span's budget. */
export function HeaderLane(p: HeaderLaneProps) {
  const { header: hd, scale, laneTop, laneH, duration } = p;
  const mid = laneTop + laneH / 2;
  const foldX = 6 + INDENT * hd.depth;
  const x0 = scale.x(Math.max(0, hd.start));
  const x1 = scale.x(Math.min(hd.end, duration));
  const select = (e: PointerEvent) => {
    e.stopPropagation();
    p.onSelect(hd.id);
  };
  const key = (e: KeyboardEvent, act: () => void) => {
    if (!activates(e)) return;
    e.preventDefault();
    act();
  };
  const fold = () => p.onFold?.(hd.id, !hd.folded);
  const budget = hd.budget !== undefined && hd.budget <= duration ? scale.x(hd.budget) : null;
  const over =
    hd.budget !== undefined && hd.over !== undefined && hd.over > 0
      ? { x: scale.x(hd.budget), w: scale.x(Math.min(hd.budget + hd.over, duration)) }
      : null;
  return (
    <g className={p.selected ? `${s.header} ${s.selected}` : s.header}>
      <rect className={s.headerBand} x={0} y={laneTop} width={WIDTH} height={laneH} />
      {/* biome-ignore lint/a11y/useSemanticElements: SVG text cannot be a <button> */}
      <text
        className={s.fold}
        x={foldX}
        y={mid + 4}
        role="button"
        tabIndex={0}
        aria-label={`${hd.folded ? 'unfold' : 'fold'} ${hd.label}`}
        aria-expanded={!hd.folded}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={fold}
        onKeyDown={(e) => key(e, fold)}
      >
        {hd.folded ? '▸' : '▾'}
      </text>
      <text
        className={s.headerLabel}
        x={foldX + FOLD_W}
        y={mid + 4}
        aria-hidden
        onPointerDown={select}
      >
        {hd.label}
      </text>
      {hd.fell && (
        <text className={s.fell} x={p.labelW - 8} y={mid + 4} textAnchor="end">
          fell
        </text>
      )}
      {over && over.w > over.x && (
        <rect
          className={s.over}
          x={over.x}
          y={laneTop + 3}
          width={over.w - over.x}
          height={laneH - 6}
          mask={p.hatchMask}
        />
      )}
      {hd.start <= duration && (
        // biome-ignore lint/a11y/useSemanticElements: an SVG shape cannot be a <button>
        <rect
          className={s.headerBar}
          x={x0}
          y={mid - BAR_H / 2}
          width={Math.max(BAR_MIN_W, x1 - x0)}
          height={BAR_H}
          rx={2}
          fill={hueColor(hd.hue)}
          role="button"
          tabIndex={0}
          aria-current={p.selected ? 'true' : undefined}
          aria-label={`${hd.label}, starts ${seconds(hd.start)}${hd.fell ? ', fell' : ''}`}
          onPointerDown={select}
          onKeyDown={(e) => key(e, () => p.onSelect(hd.id))}
        />
      )}
      {budget !== null && (
        <line
          className={s.budget}
          x1={budget}
          x2={budget}
          y1={laneTop + 2}
          y2={p.blockBottom - 2}
        />
      )}
    </g>
  );
}
