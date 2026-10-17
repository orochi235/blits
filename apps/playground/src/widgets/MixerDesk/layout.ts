import type { Desk } from './types';

export const BUS_LABEL = 52;
export const RULE_BOX = 104;
export const MIN_PITCH = 24;
export const MAX_PITCH = 56;
export const BRACKET_ROW = 18;
export const STRIP_LABEL = 84;
export const BUS_GAP = 34;
export const METER = 44;
export const READOUT = 16;
const PAD = 8;

export interface DeskLayout {
  width: number;
  height: number;
  pitch: number;
  /** Each strip's center, by id. */
  x: ReadonlyMap<string, number>;
  /** Each bus's line, by id. */
  y: ReadonlyMap<string, number>;
  /** Where the strip labels end and the strip lines start. */
  stripTop: number;
  /** Where the buses end and the meters start. */
  busBottom: number;
  /** Where the buses enter their rule boxes. */
  ruleX: number;
  /** Each group's bracket, by id. */
  brackets: ReadonlyMap<string, { x0: number; x1: number; y: number }>;
}

/**
 * Where everything sits on a desk `width` wide. The strips share the room between the bus labels
 * and the rule boxes, never closer than `MIN_PITCH`, so a crowded desk grows wider than `width`.
 */
export function layoutOf(desk: Desk, width: number): DeskLayout {
  const n = Math.max(1, desk.strips.length);
  const room = width - BUS_LABEL - RULE_BOX - PAD;
  const pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, room / n));
  const rows = Math.max(0, ...(desk.groups ?? []).map((g) => g.depth + 1));
  const x = new Map(desk.strips.map((s, i) => [s.id, BUS_LABEL + pitch * (i + 0.5)]));
  const stripTop = PAD + rows * BRACKET_ROW + STRIP_LABEL;
  const y = new Map(desk.buses.map((b, i) => [b.id, stripTop + BUS_GAP * (i + 0.75)]));
  const busBottom = stripTop + BUS_GAP * (desk.buses.length + 0.25);
  const brackets = new Map<string, { x0: number; x1: number; y: number }>();
  for (const g of desk.groups ?? []) {
    const a = x.get(g.first);
    const b = x.get(g.last);
    if (a === undefined || b === undefined) continue;
    brackets.set(g.id, {
      x0: Math.min(a, b) - pitch / 2 + 2,
      x1: Math.max(a, b) + pitch / 2 - 2,
      y: PAD + (g.depth + 1) * BRACKET_ROW - 4,
    });
  }
  const ruleX = BUS_LABEL + pitch * n;
  return {
    width: Math.max(width, ruleX + RULE_BOX + PAD),
    height: busBottom + METER + READOUT + PAD,
    pitch,
    x,
    y,
    stripTop,
    busBottom,
    ruleX,
    brackets,
  };
}

/** `text` cut to `max` characters, an ellipsis standing for the rest. */
export const clipped = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
