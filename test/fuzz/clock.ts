// Clock-law fuzz: random host calls on a transport, with frame lengths and rates that reach down to
// denormals, checked against laws the clock keeps whatever came before.
import { createHistory as tape } from '@weasel-js/history';
import { kit } from '../../src/channels.js';
import { mix } from '../../src/mixer.js';
import { transport } from '../../src/transport.js';
import type { Transport } from '../../src/types.js';
import { rng } from './rng.js';

/** A transport alone, as a clock; one with history whose seeks play; one whose seeks jump. */
export type Kind = 'bare' | 'play' | 'jump';

export type Op =
  | { k: 'sync'; dt: number }
  | { k: 'rebase' }
  | { k: 'rate'; v: number }
  | { k: 'ramp'; v: number; over: number }
  | { k: 'seek'; by: number };

const DTS = [0, 0, 5e-324, 1e-320, 2.2e-308, 1.5e-307, 1, 8, 16, 16.7, 33, 1000, 1e7] as const;
const RATES = [0, 0, 1, 1, 2, 0.5, -1, 5e-324, -5e-324, 1.23e-316, 1e-300] as const;
const OVERS = [0, 100, 333.3] as const;
const BYS = [0, 5e-324, -5e-324, 1e-308, 10, -10, 100, -100, 0.003, 250, 1e15] as const;

export function makeTransport(kind: Kind): Transport {
  if (kind === 'bare') return transport();
  const t = transport({
    history: { ms: Number.POSITIVE_INFINITY, tape },
    ...(kind === 'jump' ? { seek: 'jump' as const } : {}),
  });
  mix(kit({}), { transport: t, name: 'clock' });
  return t;
}

/** `n` random calls after a first sync. */
export function ops(seed: number, n: number): Op[] {
  const r = rng(seed);
  const out: Op[] = [];
  for (let i = 0; i < n; i++) {
    const w = r.f();
    if (w < 0.4) out.push({ k: 'sync', dt: r.pick(DTS) });
    else if (w < 0.5) out.push({ k: 'rebase' });
    else if (w < 0.65) out.push({ k: 'rate', v: r.pick(RATES) });
    else if (w < 0.8) out.push({ k: 'ramp', v: r.pick(RATES), over: r.pick(OVERS) });
    else out.push({ k: 'seek', by: r.pick(BYS) });
  }
  return out;
}

/** Whether recorded calls lie ahead on the tape, which a sync may play and a prediction not see. */
function callsAhead(t: Transport): boolean {
  const tape = t.tape;
  return tape !== undefined && tape.timestampAt(tape.undoDepth()) !== undefined;
}

/**
 * Plays `program` on `t` from host time `start`, checking the exact laws at each sync: a sync at
 * the last timestamp leaves `now` where it was, and `time(T)` read before `sync(T)` is where it
 * lands, unless a rebase is pending or calls ahead may change the clock first. A call the
 * transport refuses (a seek past history, say) is skipped. Answers the host time it ends at and
 * the first broken law, or null.
 */
export function play(
  t: Transport,
  program: readonly Op[],
  start: number,
): { host: number; broke: string | null } {
  let host = start;
  let rebased = false;
  for (const [i, op] of program.entries()) {
    const at = `call ${i} (${JSON.stringify(op)})`;
    switch (op.k) {
      case 'sync': {
        const next = host + op.dt;
        const predicts = !rebased && next >= t.timestamp && !callsAhead(t);
        const predicted = predicts ? t.time(next) : Number.NaN;
        t.sync(next);
        host = next;
        rebased = false;
        if (predicts && !Object.is(t.now, predicted))
          return { host, broke: `${at}: time() predicted ${predicted}, sync landed ${t.now}` };
        const was = t.now;
        t.sync(next);
        if (!Object.is(t.now, was))
          return { host, broke: `${at}: a sync at the same timestamp moved ${was} to ${t.now}` };
        break;
      }
      case 'rebase':
        t.rebase();
        rebased = true;
        break;
      case 'rate':
      case 'ramp':
        try {
          if (op.k === 'rate') t.rate = op.v;
          else t.ramp(op.v, op.over);
        } catch {}
        break;
      case 'seek':
        try {
          t.seek(Math.max(t.now + op.by, t.horizon));
        } catch {}
        break;
    }
  }
  return { host, broke: null };
}

/** Whether `a` and `b` agree within a few ulps of the largest magnitude a clock here worked with. */
export function near(a: number, b: number, scale: number): boolean {
  const big = Math.max(Math.abs(a), Math.abs(b), Math.abs(scale));
  return Math.abs(a - b) <= 8 * Number.EPSILON * big + 8 * Number.MIN_VALUE;
}
