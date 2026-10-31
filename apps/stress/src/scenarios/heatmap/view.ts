import { hex, tiling } from '@stress/paint';

/** Cells as a grid, each colored by its heat; `heat` is `HEAT` numbers per cell. */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  n: number,
  heat: Float64Array,
  per: number,
): void {
  const { cols, rows } = tiling(n, w, h);
  const cw = w / cols;
  const ch = h / rows;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = hex(heat.subarray(i * per, (i + 1) * per));
    ctx.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, Math.ceil(cw), Math.ceil(ch));
  }
}
