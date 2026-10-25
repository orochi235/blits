import { doubles } from './channels.js';
import type { Motions } from './motions.js';
import { reading } from './reading.js';
import { RunFlag } from './stretch.js';
import { sampleThen } from './then.js';
import type { Subject } from './voice.js';

/**
 * A motion voice's delta for a subject on the general path: what its patch's `at` gives, written
 * into the record's last delta and the array that holds, where `at` makes an object and an array a
 * call, and the patch's number for the subject kept on the record, where `at` looks it up a call.
 * `setting` has the voice time to sample at.
 */
export function moved<I>(
  run: Motions<I>,
  key: string,
  subject: I,
  setting: { readonly elapsed: number },
  rec: Subject<unknown>,
): Record<string, unknown> {
  let scalar: boolean;
  const back = reading.back;
  if (back !== null)
    scalar = (sampleThen(run, subject, setting.elapsed, back) & RunFlag.SCALAR) !== 0;
  else {
    let s = rec.run;
    if (rec.freed !== run.freed) {
      s = run.slot(subject);
      rec.run = s;
      rec.freed = run.freed;
    }
    run.sample(s, setting.elapsed, run.xs, run.vs);
    scalar = run.scalar(s);
  }
  const xs = run.xs;
  const delta = rec.delta ?? {};
  if (scalar) {
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
