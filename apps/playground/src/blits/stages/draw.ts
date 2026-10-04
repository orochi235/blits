import type { StageSpec } from '../composition';
import type { Columns } from '../player';
import type { Subject } from '../stage';

// The kit's color rests at 0 (black), so 0 draws as the base color instead.
export const BASE_COLOR = '#7aa2ff';
const PICK_COLOR = '#ff6b8b';

export const cssColor = (c: number) =>
  c === 0 ? BASE_COLOR : `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

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
  const step = Math.min(96, (w - 60) / Math.max(1, n));
  return { x: w / 2 + (i - (n - 1) / 2) * step, y: h / 2, size: step / 2 };
}

function paint(
  ctx: CanvasRenderingContext2D,
  p: Placed,
  cols: Columns,
  i: number,
  picked: boolean,
  shape: (r: number) => void,
) {
  const x = p.x + (cols.offset[i * 2] ?? 0);
  const y = p.y + (cols.offset[i * 2 + 1] ?? 0);
  const r = p.size * (cols.scale[i] ?? 1);
  const glow = cols.glow[i] ?? 0;
  const color = cssColor(cols.color[i] ?? 0);
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
  shape(r);
  if (picked) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PICK_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(-r - 4, -r - 4, r * 2 + 8, r * 2 + 8);
  }
  ctx.restore();
}

export function drawDots(
  ctx: CanvasRenderingContext2D,
  stage: { cols: number; rows: number },
  cols: Columns,
  w: number,
  h: number,
  picked: number | null,
): void {
  ctx.clearRect(0, 0, w, h);
  const n = stage.cols * stage.rows;
  for (let i = 0; i < n; i++)
    paint(ctx, dotsLayout(stage, w, h, i), cols, i, i === picked, (r) => {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      // The tick that shows turn, cut out of the fill so it reads at any color.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(0, -1, r, 2);
      ctx.globalCompositeOperation = 'source-over';
    });
}

export function drawLetters(
  ctx: CanvasRenderingContext2D,
  subjects: readonly Subject[],
  cols: Columns,
  w: number,
  h: number,
  picked: number | null,
): void {
  ctx.clearRect(0, 0, w, h);
  subjects.forEach((s, i) => {
    paint(ctx, lettersLayout(subjects.length, w, h, i), cols, i, i === picked, (r) => {
      ctx.font = `700 ${r * 1.8}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.char, 0, 0);
    });
  });
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
