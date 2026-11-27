import { describe, expect, it } from 'vitest';
import { type Kind, makeTransport, near, type Op, ops, play } from './fuzz/clock.js';
import { rng } from './fuzz/rng.js';

// Random host calls on a transport, frame lengths and rates down to denormals included, against
// the laws its clock keeps whatever came before. Exact: a sync at the last timestamp leaves `now`
// where it was, and `time(T)` is where `sync(T)` lands. Within a few ulps: two transports brought
// to the same time and rate play the same frames to the same `now`, since host time is the
// timestamp less an offset their histories left different. `BLITS_CLOCK_SEEDS=1-5000` sweeps wider.

function seeds(): number[] {
  const range = process.env.BLITS_CLOCK_SEEDS?.split('-').map(Number);
  const [from, to] = range?.length === 2 ? (range as [number, number]) : [1, 300];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const KINDS: Kind[] = ['bare', 'play', 'jump'];
const STARTS = [0, 1000, 1e7] as const;
const shown = (program: readonly Op[]) => program.map((o) => JSON.stringify(o)).join('\n');

/** The first broken law on `kind` for `seed`, with the calls that broke it; null for none. */
function broken(kind: Kind, seed: number): string | null {
  const r = rng(seed * 7919 + KINDS.indexOf(kind));
  const start = r.pick(STARTS);
  // Each law in turn on one program.
  const a = makeTransport(kind);
  a.sync(start);
  const lone = ops(seed, 40);
  const one = play(a, lone, start);
  if (one.broke !== null) return `${one.broke}\nstart ${start}\n${shown(lone)}`;

  // Two histories, then the same seek, rate and rebase, then the same frames.
  const b = makeTransport(kind);
  const before = ops(seed + 100_000, r.i(30));
  b.sync(start);
  const other = play(b, before, start);
  if (other.broke !== null) return `${other.broke}\nstart ${start}\n${shown(before)}`;
  const to = kind === 'bare' ? r.pick([0, 5e-324, 1, 100]) : Math.max(a.now, b.now) + 1;
  const rate = r.pick(kind === 'bare' ? [0, 1, 2, -1, 5e-324] : [0, 1, 2, 5e-324]);
  for (const t of [a, b]) {
    t.seek(to);
    t.rate = rate;
    t.rebase();
  }
  // Calls still ahead on either tape play in one and not the other: the frames differ by design.
  for (const t of [a, b])
    if (t.tape !== undefined && t.tape.timestampAt(t.tape.undoDepth()) !== undefined) return null;
  const frames = ops(seed + 200_000, 12).filter((o) => o.k === 'sync');
  let ha = one.host;
  let hb = other.host;
  for (const f of frames) {
    if (f.k !== 'sync') continue;
    ha += f.dt;
    hb += f.dt;
    a.sync(ha);
    b.sync(hb);
    if (!near(a.now, b.now, Math.max(ha, hb)))
      return `after the same seek to ${to}, rate ${rate} and rebase, frames of ${f.dt}: ${a.now} against ${b.now}\nstart ${start}\nfirst:\n${shown(lone)}\nother:\n${shown(before)}`;
  }
  return null;
}

describe('the transport clock keeps its laws', () => {
  for (const kind of KINDS)
    it(`${kind}, programs ${seeds()[0]} to ${seeds().at(-1)}`, () => {
      const out: string[] = [];
      for (const seed of seeds()) {
        const b = broken(kind, seed);
        if (b !== null) out.push(`program ${seed}: ${b}`);
        if (out.length >= 3) break;
      }
      expect(out).toEqual([]);
    });
});
