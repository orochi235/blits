import { hex, tiling } from '@stress/paint';

/** The LED wall: one square per tile, its color pose brightened or dimmed by its gain. */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  gain: Float64Array,
  tint: Float64Array,
): void {
  const n = gain.length;
  const { cols, rows } = tiling(n, w, h);
  const cw = w / cols;
  const ch = h / rows;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.max(0, Math.min(1, (gain[i] as number) / 1.5));
    ctx.fillStyle = hex(tint.subarray(i * 4, i * 4 + 4), 0x000000);
    ctx.fillRect((i % cols) * cw + 0.5, Math.floor(i / cols) * ch + 0.5, cw - 1, ch - 1);
  }
  ctx.globalAlpha = 1;
}
