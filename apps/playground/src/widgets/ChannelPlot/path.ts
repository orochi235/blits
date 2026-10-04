export interface Series {
  id: string;
  hue: number;
  values: readonly number[];
  thick?: boolean;
}

export function rangeOf(series: readonly Series[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const s of series)
    for (const v of s.values)
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
  if (!Number.isFinite(lo)) return [-0.5, 0.5];
  if (hi - lo < 1e-9) return [lo - 0.5, hi + 0.5];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

export function pathOf(
  times: readonly number[],
  values: readonly number[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  let d = '';
  let pen = false;
  times.forEach((t, i) => {
    const v = values[i];
    if (v === undefined || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${Math.round(x(t) * 100) / 100} ${Math.round(y(v) * 100) / 100}`;
    pen = true;
  });
  return d;
}
