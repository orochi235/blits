import { toHex } from '@msb235/blits';
import { hexOf } from '../color';
import type { StageSpec } from '../composition';
import type { Columns } from '../player';
import type { Subject } from '../stage';

/** Colors the stage takes from the theme; `base` stands in for an unwritten color (NaN) and for 0. */
export interface Palette {
  base: string;
  pick: string;
}

export const DEFAULT_PALETTE: Palette = { base: '#7aa2ff', pick: '#ff6b8b' };

export const cssColor = (c: number, base = DEFAULT_PALETTE.base) =>
  c === 0 || !Number.isFinite(c) ? base : hexOf(c);

/** Subject `i`'s color in a `pull` column of OKLab with coverage, as 0xrrggbb; NaN where unwritten. */
export const hexAt = (col: Float64Array, i: number) =>
  Number.isNaN(col[i * 4] as number) ? Number.NaN : toHex(col.subarray(i * 4, i * 4 + 4));

type Shape = (ctx: CanvasRenderingContext2D, r: number, i: number) => void;

export interface Placed {
  x: number;
  y: number;
  size: number;
}

export function dotsLayout(
  stage: { cols: number; rows: number },
  w: number,
  h: number,
  i: number,
): Placed {
  const pad = 40;
  const col = i % stage.cols;
  const row = Math.floor(i / stage.cols);
  const dx = stage.cols > 1 ? (w - pad * 2) / (stage.cols - 1) : 0;
  const dy = stage.rows > 1 ? (h - pad * 2) / (stage.rows - 1) : 0;
  return {
    x: stage.cols > 1 ? pad + col * dx : w / 2,
    y: stage.rows > 1 ? pad + row * dy : h / 2,
    size: Math.max(3, Math.min(dx || 40, dy || 40) * 0.28),
  };
}

export function lettersLayout(n: number, w: number, h: number, i: number): Placed {
  const step = Math.max(0, Math.min(96, (w - 60) / Math.max(1, n)));
  return { x: w / 2 + (i - (n - 1) / 2) * step, y: h / 2, size: step / 2 };
}

function paint(
  ctx: CanvasRenderingContext2D,
  p: Placed,
  cols: Columns,
  i: number,
  picked: boolean,
  palette: Palette,
  shape: Shape,
) {
  const x = p.x + (cols.offset[i * 2] ?? 0);
  const y = p.y + (cols.offset[i * 2 + 1] ?? 0);
  const r = Math.max(0, p.size * (cols.scale[i] ?? 1));
  const glow = cols.glow[i] ?? 0;
  const color = cssColor(hexAt(cols.color, i), palette.base);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((cols.turn[i] ?? 0) * Math.PI) / 180);
  ctx.globalAlpha = Math.max(0, Math.min(1, cols.opacity[i] ?? 1));
  ctx.fillStyle = color;
  if (glow > 0) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * Math.min(1, 0.25 * glow);
    ctx.beginPath();
    ctx.arc(0, 0, r * (1 + glow), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  shape(ctx, r, i);
  if (picked) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.pick;
    ctx.lineWidth = 2;
    ctx.strokeRect(-r - 4, -r - 4, r * 2 + 8, r * 2 + 8);
  }
  ctx.restore();
}

const dot: Shape = (ctx, r) => {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // The tick that shows turn, cut out of the fill so it reads at any color.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, -1, r, 2);
  ctx.globalCompositeOperation = 'source-over';
};

export function drawDots(
  ctx: CanvasRenderingContext2D,
  stage: { cols: number; rows: number },
  cols: Columns,
  w: number,
  h: number,
  picked: number | null,
  palette: Palette = DEFAULT_PALETTE,
): void {
  ctx.clearRect(0, 0, w, h);
  const n = stage.cols * stage.rows;
  for (let i = 0; i < n; i++)
    paint(ctx, dotsLayout(stage, w, h, i), cols, i, i === picked, palette, dot);
}

const fontFor = (r: number) => `700 ${r * 1.8}px Georgia, serif`;

export function drawLetters(
  ctx: CanvasRenderingContext2D,
  subjects: readonly Subject[],
  cols: Columns,
  w: number,
  h: number,
  picked: number | null,
  palette: Palette = DEFAULT_PALETTE,
): void {
  ctx.clearRect(0, 0, w, h);
  const n = subjects.length;
  if (n === 0) return;
  // Set outside paint's save/restore, so an unscaled letter keeps it without reassigning.
  const base = lettersLayout(n, w, h, 0).size;
  ctx.font = fontFor(base);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const letter: Shape = (c, r, i) => {
    if (r !== base) c.font = fontFor(r);
    c.fillText(subjects[i]?.char ?? '', 0, 0);
  };
  for (let i = 0; i < n; i++)
    paint(ctx, lettersLayout(n, w, h, i), cols, i, i === picked, palette, letter);
}

/** Picks by base position, so a subject that has moved far is picked where it started. */
export function pickAt(
  stage: StageSpec,
  subjects: readonly Subject[],
  x: number,
  y: number,
  w: number,
  h: number,
): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < subjects.length; i++) {
    const p =
      stage.kind === 'dots' ? dotsLayout(stage, w, h, i) : lettersLayout(subjects.length, w, h, i);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD && d < p.size * 1.5) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
