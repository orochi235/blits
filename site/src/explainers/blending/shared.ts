import { label, trace } from '../kit/draw';
import type { Ink } from '../kit/ink';

export interface Dot {
  i: number;
}

export const row = (n: number): Dot[] => Array.from({ length: n }, (_, i) => ({ i }));

/**
 * A trace on a fixed time axis, 0 to `duration` left to right, with a cursor at `t` and a dashed
 * line at each mark.
 */
export function timeline(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ink: Ink,
  series: Parameters<typeof trace>[3],
  opts: {
    t: number;
    duration: number;
    min?: number;
    max?: number;
    label: string;
    marks?: { at: number; text: string }[];
  },
): void {
  trace(ctx, box, ink, series, {
    t: opts.duration,
    span: opts.duration,
    min: opts.min,
    max: opts.max,
    label: opts.label,
  });
  const px = (t: number) => Math.round(box.x + (t / opts.duration) * box.w) + 0.5;
  ctx.lineWidth = 1;
  for (const m of opts.marks ?? []) {
    ctx.strokeStyle = ink.soft;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px(m.at), box.y);
    ctx.lineTo(px(m.at), box.y + box.h);
    ctx.stroke();
    ctx.setLineDash([]);
    label(
      ctx,
      m.text,
      px(m.at) + 5,
      box.y + box.h - 8,
      ink.soft,
      'left',
      /\(|^deadline$/.test(m.text),
    );
  }
  ctx.strokeStyle = ink.ink;
  ctx.beginPath();
  ctx.moveTo(px(opts.t), box.y);
  ctx.lineTo(px(opts.t), box.y + box.h);
  ctx.stroke();
}

export const points = (history: { t: number; values: number[] }[], i: number): [number, number][] =>
  history.map((h) => [h.t, h.values[i] ?? 0]);

export const EASES = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
