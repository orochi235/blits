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
  remaps: { transport: false, store: false, remaps: true },
  'remaps, transport and store': { transport: true, store: true, remaps: true },
};

/** Each lanes setting's first failing check, shrunk to the calls that still fail it. */
async function failures(
  seed: number,
  transport: boolean,
  store: boolean,
  jumps = false,
  remaps = false,
): Promise<string[]> {
  const out: string[] = [];
  const p = program(seed, { transport, jumps, remaps, noFadeRest: remaps, ...KNOWN });
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

/** Programs past the default range that each found a bug, in the mode they found it in. */
const PINNED: [number, keyof typeof modes][] = [
  // A seek back took the state play stepped on to, and lost the sends of the steps it skipped.
  [242, 'remaps'],
  // A seek keeping state past a voice's end left it stepped only to its last probe.
  [243, 'remaps, transport and store'],
  // A subject met later moved a voice's end, and an anchor on its score kept the old one.
  [259, 'remaps, transport and store'],
  // A store let go of the rate a mark was announced under, and the mark moved.
  [344, 'remaps, transport and store'],
];

describe('seek and replay against straight play', () => {
  const cases = [
    ...Object.keys(modes).flatMap((name) => seeds().map((seed) => [seed, name] as const)),
    ...PINNED.filter(([seed]) => !seeds().includes(seed)),
  ];
  for (const [seed, name] of cases)
    it(`program ${seed}, ${name}`, async () => {
      const mode = modes[name as keyof typeof modes];
      const jumps = 'jumps' in mode && mode.jumps;
      const remaps = 'remaps' in mode && mode.remaps;
      expect(await failures(seed, mode.transport, mode.store, jumps, remaps)).toEqual([]);
    });
});
