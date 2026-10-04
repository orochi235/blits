import type { Clip } from './index';

/** Most passes a clip shows dividers for, and most its end handle snaps to. */
export const MAX_PASSES = 200;

export interface Scale {
  x(t: number): number;
  t(x: number): number;
}

export function scaleOf(duration: number, width: number, labelWidth: number): Scale {
  const span = Math.max(1, width - labelWidth);
  const d = duration > 0 ? duration : 1;
  return {
    x: (t) => labelWidth + (t / d) * span,
    t: (x) => ((x - labelWidth) / span) * d,
  };
}

export function clipEnd(c: Clip): number {
  if (!Number.isFinite(c.passes)) return Number.POSITIVE_INFINITY;
  return c.start + (c.pass > 0 ? c.pass * c.passes : 0);
}

export function clipPolygon(c: Clip, s: Scale, top: number, h: number, viewEnd: number): string {
  const end = Math.min(clipEnd(c), viewEnd);
  const open = !Number.isFinite(clipEnd(c));
  const x0 = s.x(c.start);
  const x1 = s.x(end);
  const inX = s.x(c.start + c.fadeIn);
  const outX = open ? x1 : s.x(end - c.fadeOut);
  const fmt = (x: number, y: number) => `${Math.round(x * 100) / 100},${y}`;
  return [fmt(x0, top + h), fmt(inX, top), fmt(outX, top), fmt(x1, top + h)].join(' ');
}

export function passLines(c: Clip, viewEnd: number): number[] {
  if (c.pass <= 0) return [];
  const end = Math.min(clipEnd(c), viewEnd);
  const out: number[] = [];
  for (let t = c.start + c.pass; t < end - 1e-9 && out.length < MAX_PASSES; t += c.pass)
    out.push(t);
  return out;
}

export interface Bracket {
  group: string;
  hue: number;
  from: number; // first lane
  to: number; // last lane
}

/** One bracket per group of two or more clips, hued by its first clip, in order of first appearance. */
export function groupBrackets(clips: readonly Clip[]): Bracket[] {
  const out = new Map<string, Bracket & { count: number }>();
  for (const c of clips) {
    if (c.group === undefined) continue;
    const b = out.get(c.group);
    if (!b) out.set(c.group, { group: c.group, hue: c.hue, from: c.lane, to: c.lane, count: 1 });
    else {
      b.from = Math.min(b.from, c.lane);
      b.to = Math.max(b.to, c.lane);
      b.count++;
    }
  }
  return [...out.values()]
    .filter((b) => b.count > 1)
    .map(({ group, hue, from, to }) => ({ group, hue, from, to }));
}
