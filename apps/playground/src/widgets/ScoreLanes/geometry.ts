import type { Clip } from './index';

export interface Scale {
  x(t: number): number;
  t(x: number): number;
}

export function scaleOf(duration: number, width: number, labelWidth: number): Scale {
  const span = Math.max(1, width - labelWidth);
  return {
    x: (t) => labelWidth + (t / duration) * span,
    t: (x) => ((x - labelWidth) / span) * duration,
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
  for (let t = c.start + c.pass; t < end - 1e-9 && out.length < 200; t += c.pass) out.push(t);
  return out;
}
