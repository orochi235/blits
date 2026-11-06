import { type NumberRule, numberChannel } from '@pg/blits/kit';

/** What the stamp sweeps for a rule with no bounds: the fold so far along x, and the voice's value. */
const SPAN: Record<NumberRule, readonly [number, number]> = {
  sum: [-1, 1],
  mul: [0, 2],
  max: [0, 1],
  min: [0, 1],
  norm: [0, 1],
  last: [0, 1],
  angle: [0, 360],
};

/** One voice value's curve: its place among the voice values (0 to 1), and its points in a unit square. */
export interface StampCurve {
  t: number;
  /** Runs of points, split where an angle wraps; y is up. */
  runs: [number, number][][];
}

/**
 * The output of `rule` against what the fold holds so far, once for each of `count` voice values,
 * folded by the kit's own channel at `weight`.
 */
export function stampCurves(rule: NumberRule, count: number, weight = 1, steps = 96): StampCurve[] {
  const channel = numberChannel({ rule });
  const [lo, hi] = SPAN[rule];
  const wrap = rule === 'angle' ? (o: number) => ((o % hi) + hi) % hi : (o: number) => o;
  // A channel with no `scale` (`last`) takes a voice whole or not at all; the mix's gate sits near half.
  const fold = (a: number, v: number) =>
    channel.scale
      ? channel.merge(a, channel.scale(v, weight))
      : weight >= 0.5
        ? channel.merge(a, v)
        : a;
  const raw = Array.from({ length: count }, (_, k) => {
    const v = lo + ((hi - lo) * (k + 0.5)) / count;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = lo + ((hi - lo) * i) / steps;
      return [a, wrap(fold(a, v))] as [number, number];
    });
  });
  const ys = raw.flat().map(([, o]) => o);
  const [ylo, yhi] = rule === 'angle' ? [lo, hi] : [Math.min(...ys, lo), Math.max(...ys, hi)];
  return raw.map((points, k) => {
    const runs: [number, number][][] = [[]];
    let prev: number | null = null;
    for (const [a, o] of points) {
      if (prev !== null && Math.abs(o - prev) > (yhi - ylo) / 2) runs.push([]);
      runs[runs.length - 1]?.push([(a - lo) / (hi - lo), (o - ylo) / (yhi - ylo || 1)]);
      prev = o;
    }
    return { t: count > 1 ? k / (count - 1) : 0.5, runs };
  });
}
