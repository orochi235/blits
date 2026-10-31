/** Fallback view: every number `read` wrote as a gray square, scaled to the range seen so far. */
export function grid(
  ctx: CanvasRenderingContext2D,
  values: Float64Array,
  w: number,
  h: number,
): void {
  const n = values.length;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi > lo ? hi - lo : 1;
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * w) / h)));
  const rows = Math.ceil(n / cols);
  const cw = w / cols;
  const ch = h / rows;
  for (let i = 0; i < n; i++) {
    const g = Math.round(255 * (((values[i] as number) - lo) / span));
    ctx.fillStyle = `rgb(${g} ${g} ${g})`;
    ctx.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
  }
}
