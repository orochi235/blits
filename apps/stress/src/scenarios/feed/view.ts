interface Columns {
  y: Float64Array;
  alpha: Float64Array;
  /** Bar length and hue, 0 to 1, fixed per item so a re-sort shows as bars changing places. */
  share: Float64Array;
}

/** One bar per item at its `y`, faded by `alpha`, the list squeezed to fit; the first `listed` are on the list, the rest leaving. */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  n: number,
  { y, alpha, share }: Columns,
  rowPx: number,
  listed: number,
): void {
  const scale = Math.min(1, (h - 2) / (Math.max(listed, 1) * rowPx));
  const bar = Math.max(1, rowPx * scale - 1);
  for (let i = 0; i < n; i++) {
    const a = alpha[i] as number;
    const top = (y[i] as number) * scale;
    if (!(a > 0) || !Number.isFinite(top)) continue;
    const s = share[i] as number;
    ctx.globalAlpha = Math.min(1, a);
    ctx.fillStyle = i < listed ? `hsl(${190 + 140 * s} 70% 58%)` : '#c24a4a';
    ctx.fillRect(0, 1 + top, Math.max(2, (w - 2) * (0.1 + 0.9 * s)), bar);
  }
  ctx.globalAlpha = 1;
}
