/**
 * A track's paths, in a box 1 wide and 1 tall that stands for the whole run. Each sample goes where
 * it was taken, `at[k]` ms of a run `length` ms long, never at its index: samples snapped to the
 * frames a mix played land unevenly, and spaced evenly a ramp draws as a wobbling staircase. The
 * playground's score and the site's explainer timeline both draw from here.
 */

const xOf = (at: readonly number[], length: number, k: number) =>
  length > 0 ? (at[k] ?? 0) / length : 0;

/** Gradient stops for `colors`, every few samples, each where its sample was taken. */
export function stops(
  colors: readonly string[],
  at: readonly number[],
  length: number,
): { at: number; color: string }[] {
  const n = colors.length;
  const every = Math.max(1, Math.floor(n / 60));
  const out = [];
  for (let k = 0; k < n; k += every)
    out.push({ at: xOf(at, length, k), color: colors[k] as string });
  return out;
}

/** `values` stretched to fill 0..1 from their lowest to their highest. */
export function spread(values: readonly number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5));
}

/** A curve through 0..1 values, kept `inset` from the box's top and bottom. */
export function curve(
  values: readonly number[],
  at: readonly number[],
  length: number,
  inset = 0.1,
): string {
  const y = (v: number) => 1 - Math.min(1, Math.max(0, v)) * (1 - 2 * inset) - inset;
  return values
    .map((v, k) => `${k === 0 ? 'M' : 'L'}${xOf(at, length, k).toFixed(5)},${y(v).toFixed(3)}`)
    .join(' ');
}

/** The area under a weight curve, `inset` as `curve` takes it, filled to the box's foot. */
export function area(
  weights: readonly number[],
  at: readonly number[],
  length: number,
  inset = 0,
): string {
  const n = weights.length;
  if (n === 0) return '';
  const first = xOf(at, length, 0).toFixed(5);
  const last = xOf(at, length, n - 1).toFixed(5);
  return `${curve(weights, at, length, inset)} L${last},1 L${first},1 Z`;
}
