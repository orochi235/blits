import { hueColor } from '@msb235/blits-panel';
import type { KeyboardEvent } from 'react';
import { BUS_LABEL, clipped, layoutOf, METER, RULE_BOX, STRIP_LABEL } from './layout';
import s from './MixerDesk.module.css';
import type { Desk } from './types';

export interface MixerDeskProps {
  desk: Desk;
  /** The room across; a desk whose strips do not fit grows wider. */
  width: number;
  /** The selected strip's or group's id. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}

const TAP = 5;
const unit = (v: number) => Math.min(1, Math.max(0, v));
const colorOf = (hue: number | undefined) =>
  hue === undefined ? 'var(--wzl-fg-muted)' : hueColor(hue);

export function MixerDesk({ desk, width, selected, onSelect }: MixerDeskProps) {
  const at = layoutOf(desk, width);
  const pick = (id: string | null) => onSelect?.(id);
  const button = (id: string, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': selected === id,
    onClick: () => pick(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      pick(id);
    },
  });
  const meterTop = at.busBottom + 2;
  const meterHeight = METER - 6;
  const ruleLeft = at.ruleX + 6;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the strips and brackets take keys; this only clears
    <svg
      className={s.desk}
      width={at.width}
      height={at.height}
      aria-label="mixer desk"
      onClick={(e) => e.target === e.currentTarget && pick(null)}
    >
      {desk.buses.map((b) => {
        const y = at.y.get(b.id) ?? 0;
        return (
          <g key={b.id} data-bus={b.id}>
            <text className={s.busLabel} x={BUS_LABEL - 6} y={y + 4}>
              {clipped(b.label, 8)}
            </text>
            <line className={s.bus} x1={BUS_LABEL - 2} x2={ruleLeft} y1={y} y2={y} />
            <path
              className={s.busEnd}
              d={`M ${ruleLeft - 5} ${y - 4} L ${ruleLeft} ${y} L ${ruleLeft - 5} ${y + 4}`}
            />
            <rect
              className={s.rule}
              x={ruleLeft}
              y={y - 14}
              width={RULE_BOX - 10}
              height={28}
              rx={3}
            />
            <text className={s.ruleText} x={ruleLeft + 5} y={y - 3}>
              <title>{b.rule}</title>
              {clipped(b.rule, 16)}
            </text>
            {b.swatch && (
              <rect
                className={s.swatch}
                x={ruleLeft + 5}
                y={y + 2}
                width={9}
                height={9}
                fill={b.swatch}
              />
            )}
            {b.value !== undefined && (
              <text className={s.value} x={ruleLeft + RULE_BOX - 15} y={y + 10}>
                {b.value}
              </text>
            )}
          </g>
        );
      })}
      {(desk.groups ?? []).map((g) => {
        const k = at.brackets.get(g.id);
        if (!k) return null;
        const level = g.level === undefined ? '' : ` ${g.level.toFixed(2)}`;
        const room = Math.max(2, Math.floor((k.x1 - k.x0) / 6.2));
        const text =
          g.label.length + level.length <= room ? `${g.label}${level}` : clipped(g.label, room);
        return (
          <g
            key={g.id}
            className={selected === g.id ? `${s.bracket} ${s.picked}` : s.bracket}
            data-group={g.id}
            {...button(g.id, `group ${g.label}`)}
          >
            <title>{g.label}</title>
            <rect className={s.hit} x={k.x0} y={k.y - 14} width={k.x1 - k.x0} height={18} />
            <path
              className={g.faulted ? `${s.bracketLine} ${s.faulted}` : s.bracketLine}
              d={`M ${k.x0} ${k.y + 4} V ${k.y} H ${k.x1} V ${k.y + 4}`}
              stroke={colorOf(g.hue)}
            />
            <text
              className={g.faulted ? `${s.bracketText} ${s.faulted}` : s.bracketText}
              x={(k.x0 + k.x1) / 2}
              y={k.y - 3}
            >
              {text}
            </text>
          </g>
        );
      })}
      {desk.strips.map((st) => {
        const x = at.x.get(st.id) ?? 0;
        const stroke = st.faulted ? 'var(--wzl-danger)' : colorOf(st.hue);
        const lit = st.level === undefined ? 1 : unit(st.level);
        const fill = st.level === undefined ? 0 : meterHeight * unit(st.level);
        return (
          <g
            key={st.id}
            className={selected === st.id ? `${s.strip} ${s.picked}` : s.strip}
            data-strip={st.id}
            {...button(st.id, `voice ${st.label}`)}
          >
            <title>{st.detail ? `${st.label} · ${st.detail}` : st.label}</title>
            <rect
              className={s.hit}
              x={x - at.pitch / 2 + 1}
              y={at.stripTop - STRIP_LABEL}
              width={at.pitch - 2}
              height={at.height - at.stripTop + STRIP_LABEL - 4}
              rx={3}
            />
            <text
              className={st.faulted ? `${s.stripLabel} ${s.faulted}` : s.stripLabel}
              transform={`translate(${x + 4} ${at.stripTop - 6}) rotate(-90)`}
            >
              {clipped(st.label, 13)}
            </text>
            <line
              className={st.faulted ? `${s.stripLine} ${s.faulted}` : s.stripLine}
              x1={x}
              x2={x}
              y1={at.stripTop - 2}
              y2={meterTop}
              stroke={stroke}
            />
            {st.taps.map((bus) => {
              const y = at.y.get(bus);
              return y === undefined ? null : (
                <circle
                  key={bus}
                  className={s.tap}
                  cx={x}
                  cy={y}
                  r={TAP}
                  stroke={stroke}
                  fill={stroke}
                  fillOpacity={lit}
                />
              );
            })}
            <rect
              className={s.well}
              x={x - 5}
              y={meterTop}
              width={10}
              height={meterHeight}
              rx={2}
            />
            {fill > 0 && (
              <rect
                x={x - 5}
                y={meterTop + meterHeight - fill}
                width={10}
                height={fill}
                rx={2}
                fill={stroke}
              />
            )}
            <text className={s.readout} x={x} y={meterTop + meterHeight + 13}>
              {st.level === undefined ? '' : st.level.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
