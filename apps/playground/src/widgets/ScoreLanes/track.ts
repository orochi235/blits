/** Gradient stops for `colors` spread across the run, every few samples. */
export function stops(colors: readonly string[]): { at: number; color: string }[] {
  const n = colors.length;
  const every = Math.max(1, Math.floor(n / 60));
  const out = [];
  for (let k = 0; k < n; k += every)
    out.push({ at: n > 1 ? k / (n - 1) : 0, color: colors[k] as string });
  return out;
}

/** `values` stretched to fill 0..1 from their lowest to their highest. */
export function spread(values: readonly number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5));
}

/** A curve through 0..1 values in a box `n - 1` wide and 1 tall, kept `inset` from its edges. */
export function curve(values: readonly number[], inset = 0.1): string {
  const y = (v: number) => 1 - Math.min(1, Math.max(0, v)) * (1 - 2 * inset) - inset;
  return values.map((v, k) => `${k === 0 ? 'M' : 'L'}${k},${y(v).toFixed(3)}`).join(' ');
}

/** The area under a weight curve, filling the box at weight 1. */
export function area(weights: readonly number[]): string {
  const n = weights.length;
  if (n === 0) return '';
  return `${curve(weights, 0)} L${n - 1},1 L0,1 Z`;
}
