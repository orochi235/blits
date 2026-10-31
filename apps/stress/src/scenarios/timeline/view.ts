import { hex } from '@stress/paint';
import { SEQ_MS, SEQUENCES, type Timeline } from './build';

/** Clips as thin layers stacked down the canvas in reel order, sequences banded, the playhead a line across: a bar at the clip's `x`, in its tint, faded by its opacity. */
export function draw(
  t: Timeline,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  playhead: number,
): void {
  t.m.pull(t.clips, { x: t.x, opacity: t.opacity, tint: t.tint });
  const n = t.clips.length;
  const row = h / n;
  const reach = Math.max(1200, ...t.x) * 1.05;
  ctx.fillStyle = '#1b1e25';
  for (let q = 1; q < SEQUENCES; q += 2) ctx.fillRect(0, (h * q) / SEQUENCES, w, h / SEQUENCES);
  ctx.fillStyle = '#242934';
  for (let i = 0; i < n; i += 2) ctx.fillRect(0, i * row, w, row);
  for (let i = 0; i < n; i++) {
    const a = t.opacity[i] as number;
    if (!(a > 0.01) || !((t.tint[i * 4 + 3] as number) > 0.01)) continue;
    ctx.globalAlpha = Math.min(1, a);
    ctx.fillStyle = hex(t.tint.subarray(i * 4, i * 4 + 4));
    ctx.fillRect(((t.x[i] as number) / reach) * (w - 60), i * row - 4, 60, Math.max(8, row + 1));
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, Math.min(h - 1, (playhead / (SEQUENCES * SEQ_MS)) * h), w, 1);
}
