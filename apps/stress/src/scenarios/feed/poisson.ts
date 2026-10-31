import type { Rng } from '@stress/rng';

/** Knuth's method, in chunks so a large mean cannot underflow `exp(-mean)`. */
export function poisson(rand: Rng, mean: number): number {
  let n = 0;
  let left = mean;
  while (left > 0) {
    const part = Math.min(left, 20);
    left -= part;
    const limit = Math.exp(-part);
    let p = 1;
    for (;;) {
      p *= rand.next();
      if (p <= limit) break;
      n++;
    }
  }
  return n;
}
