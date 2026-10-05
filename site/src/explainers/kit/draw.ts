import type { Size } from './Explainer';
import type { Ink } from './ink';

const LABEL = '500 13px Archivo, "Helvetica Neue", Arial, sans-serif';
const MONO = '12px "JetBrains Mono", ui-monospace, Menlo, monospace';

export interface Row {
  label: string;
  color: string;
  value: number | undefined;
  strong?: boolean;
}

/** Rows of values on one shared scale, each drawn as a bar from rest to its value. */
export function numberLine(
  ctx: CanvasRenderingContext2D,
  size: Size,
  ink: Ink,
  opts: { from: number; to: number; rest?: number; rows: Row[] },
): void {
  const left = 72;
  const right = size.w - 64;
  const top = 18;
  const bottom = size.h - 28;
  const x = (v: number) => left + ((v - opts.from) / (opts.to - opts.from)) * (right - left);
  const rowH = (bottom - top) / opts.rows.length;

  ctx.strokeStyle = ink.rule;
  ctx.fillStyle = ink.soft;
  ctx.font = MONO;
  ctx.textAlign = 'center';
  ctx.lineWidth = 1;
  for (let v = Math.ceil(opts.from); v <= opts.to; v++) {
    ctx.beginPath();
    ctx.moveTo(x(v) + 0.5, top);
    ctx.lineTo(x(v) + 0.5, bottom);
    ctx.stroke();
    ctx.fillText(String(v), x(v), size.h - 10);
  }
  if (opts.rest !== undefined) {
    ctx.strokeStyle = ink.soft;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x(opts.rest) + 0.5, top - 6);
    ctx.lineTo(x(opts.rest) + 0.5, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText('rest', x(opts.rest), top - 8);
  }

  opts.rows.forEach((row, i) => {
    const cy = top + rowH * (i + 0.5);
    ctx.font = LABEL;
    ctx.textAlign = 'right';
    ctx.fillStyle = row.strong ? ink.ink : ink.soft;
    ctx.fillText(row.label, left - 12, cy + 4);
    if (row.value === undefined) {
      ctx.font = MONO;
      ctx.textAlign = 'left';
      ctx.fillText('no value', left + 4, cy + 4);
      return;
    }
    const from = x(opts.rest ?? opts.from);
    const to = x(Math.max(opts.from, Math.min(opts.to, row.value)));
    const h = row.strong ? 12 : 8;
    ctx.fillStyle = row.color;
    ctx.globalAlpha = row.strong ? 1 : 0.85;
    ctx.fillRect(Math.min(from, to), cy - h / 2, Math.abs(to - from) || 1, h);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(to, cy, row.strong ? 6 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = MONO;
    ctx.textAlign = 'left';
    ctx.fillStyle = row.strong ? ink.ink : ink.soft;
    ctx.fillText(row.value.toFixed(3), right + 10, cy + 4);
  });
}

/** Subjects as a row of dots: each dot's lift, size and fill come from its pose. */
export function dots(
  ctx: CanvasRenderingContext2D,
  size: Size,
  ink: Ink,
  items: { lift: number; scale?: number; color?: string; alpha?: number }[],
  opts: { baseline?: number; range?: number } = {},
): void {
  const n = items.length;
  const gap = size.w / (n + 1);
  const base = size.h * (opts.baseline ?? 0.72);
  const range = size.h * (opts.range ?? 0.5);
  ctx.strokeStyle = ink.rule;
  ctx.beginPath();
  ctx.moveTo(gap / 2, base + 0.5);
  ctx.lineTo(size.w - gap / 2, base + 0.5);
  ctx.stroke();
  items.forEach((it, i) => {
    const cx = gap * (i + 1);
    const cy = base - it.lift * range;
    const r = Math.max(1, Math.min(gap * 0.35, 12) * (it.scale ?? 1));
    ctx.globalAlpha = it.alpha ?? 1;
    ctx.fillStyle = it.color ?? ink.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

/** A time trace: each series drawn over the last `span` ms up to now, newest at the right. */
export function trace(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ink: Ink,
  series: { color: string; points: [number, number][]; width?: number; dash?: number[] }[],
  opts: { t: number; span: number; min?: number; max?: number; label?: string },
): void {
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const px = (t: number) => box.x + box.w - ((opts.t - t) / opts.span) * box.w;
  const py = (v: number) => box.y + box.h - ((v - min) / (max - min)) * box.h;
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
  if (opts.label) {
    ctx.font = LABEL;
    ctx.fillStyle = ink.soft;
    ctx.textAlign = 'left';
    ctx.fillText(opts.label, box.x + 6, box.y + 16);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 2;
    ctx.setLineDash(s.dash ?? []);
    ctx.beginPath();
    s.points.forEach(([t, v], i) => {
      if (i === 0) ctx.moveTo(px(t), py(v));
      else ctx.lineTo(px(t), py(v));
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** A text label on the stage. `code` sets it in the mono face, for an API name like `fade()`. */
export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
  code = false,
): void {
  ctx.font = code ? MONO : LABEL;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

/**
 * A lamp lit to `level` (0 dark, 1 full, more glows past full), for a stage showing what a channel
 * drives: a dim rim always, so a dark lamp still reads as a lamp.
 */
export function lamp(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  x: number,
  y: number,
  r: number,
  level: number,
  color: string,
): void {
  const lit = Math.max(0, Math.min(1, level));
  const over = Math.max(0, Math.min(1, level - 1));
  ctx.globalAlpha = 0.12 + 0.88 * lit;
  ctx.fillStyle = color;
  // A shadow glows in the lamp's own color; a gradient to 'transparent' grays out on light paper.
  ctx.shadowColor = color;
  ctx.shadowBlur = lit > 0 ? r * (1.6 + over) * lit : 0;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 1;
  ctx.stroke();
}
