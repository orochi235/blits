import { describe, expect, it } from 'vitest';
import {
  type Check,
  describeOps,
  type GenOpts,
  type Mode,
  play,
  program,
  run,
  shrink,
} from './fuzz/replay.js';

// Plays random programs of host calls straight through, then checks that a seek back to a frame,
// or to a mix time, and playing on from there show what each frame showed, and that reads back
// and ahead agree with it. `BLITS_REPLAY_SEEDS=1-200` sweeps a wider range.

/** Cases with a known cause, kept out until it is fixed: see `GenOpts`. */
const KNOWN: Omit<GenOpts, 'transport'> = {};

function seeds(): number[] {
  const range = process.env.BLITS_REPLAY_SEEDS?.split('-').map(Number);
  const [from, to] = range?.length === 2 ? (range as [number, number]) : [1, 8];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const modes = {
  alone: { transport: false, store: false },
  transport: { transport: true, store: false },
  store: { transport: false, store: true },
  'transport and store': { transport: true, store: true },
  'transport, jumps': { transport: true, store: false, jumps: true },
};

/** Each lanes setting's first failing check, shrunk to the calls that still fail it. */
async function failures(
  seed: number,
  transport: boolean,
  store: boolean,
  jumps = false,
): Promise<string[]> {
  const out: string[] = [];
  const p = program(seed, { transport, jumps, ...KNOWN });
  for (const lanes of [true, false]) {
    const mode: Mode = { lanes, transport, store, jump: jumps };
    const { e, rec } = play(p, mode);
    for (const m of e.ms) m.close();
    const frames = rec.now.length;
    const at = [2, 5, 9, 14, 20, 27, frames - 3].filter((k) => k > 0 && k < frames);
    search: for (const kind of ['seek', 'seekTime', 'behind', 'ahead'] as const)
      for (const k of at) {
        const c: Check = { kind, k };
        const f = await run(p, mode, c, rec);
        if (f === null || f.startsWith('refused')) continue;
        const s = await shrink(p, mode, c);
        out.push(
          `lanes ${lanes}, ${kind} at frame ${k}: ${f}\n${describeOps(s.p)}\n=> ${s.failure}`,
        );
        break search;
      }
  }
  return out;
}

describe('seek and replay against straight play', () => {
  for (const [name, mode] of Object.entries(modes))
    for (const seed of seeds())
      it(`program ${seed}, ${name}`, async () => {
        const jumps = 'jumps' in mode && mode.jumps;
        expect(await failures(seed, mode.transport, mode.store, jumps)).toEqual([]);
      });
});
