import { doubles } from './channels.js';
import type { Motions } from './motions.js';

/**
 * A motion voice's delta for a subject on the general path: what its patch's `at` gives, written
 * into the record's last delta and the array that holds, where `at` makes an object and an array a
 * call. `setting` has the voice time to sample at.
 */
export function moved<I>(
  run: Motions<I>,
  key: string,
  subject: I,
  setting: { readonly elapsed: number },
  last: Record<string, unknown> | null,
): Record<string, unknown> {
  const s = run.slot(subject);
  const xs = run.xs;
  run.sample(s, setting.elapsed, xs, run.vs);
  const delta = last ?? {};
  if (run.scalar(s)) {
    delta[key] = xs[0] as number;
    return delta;
  }
  const n = run.n;
  const held = delta[key];
  const out = Array.isArray(held) && held.length === n ? (held as number[]) : doubles(n, 0);
  for (let i = 0; i < n; i++) out[i] = xs[i] as number;
  delta[key] = out;
  return delta;
}
