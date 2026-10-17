import { describe, expect, it } from 'vitest';
import { check, type ProgramOptions, type Property, program, standing } from './fuzz/program.js';

const variants = {
  plain: {},
  full: { anchors: true, stateful: true, mixRate: true },
  fresh: { anchors: true, stateful: true, mixRate: true, fresh: true },
  slewed: { cuesOnly: true, stateful: true, slewed: true },
} satisfies Record<string, ProgramOptions>;
type Variant = keyof typeof variants;

/** Seeds 1 to `seeds` are checked; `unknown` lists the ones failing today, `todo` a whole gap. */
interface Known {
  seeds: number;
  unknown?: number[];
  todo?: string;
}

const all = { seeds: 150 };
// A seed that starts failing is a regression; `shrink` in ./fuzz/program.ts reduces it to its cause.
// A `fresh` voice depends on when a subject was first probed, by design, so the variant is left out
// wherever a subject can be first met other than frame by frame: in a read ahead, after frames
// played with no probe, or at a different frame spacing. Reads with no history refuse state.
const known: Record<Property, Partial<Record<Variant, Known>>> = {
  seek: { plain: all, full: all, fresh: all, slewed: all },
  again: {
    plain: all,
    full: all,
    slewed: { seeds: 150, todo: "a second seek puts a slew's state back wrong; see HANDOFF" },
  },
  behind: {
    plain: all,
    full: all,
    fresh: all,
    slewed: {
      seeds: 150,
      todo: "a read back after a drop shows the slew's old state; see HANDOFF",
    },
  },
  ahead: { plain: all, full: all, slewed: all },
  taped: { plain: all, full: all, slewed: all },
  dt: { plain: all, full: all, slewed: all },
  standing: { plain: all, full: all, slewed: all },
  now: { plain: all, full: all, fresh: all, slewed: all },
  frame: {
    plain: all,
    full: all,
    fresh: all,
    slewed: {
      seeds: 150,
      todo: "a read back shows a slew's state wrong, as behind does; see HANDOFF",
    },
  },
};

function guards(prop: Property) {
  for (const variant of Object.keys(variants) as Variant[]) {
    const entry = known[prop][variant];
    if (entry === undefined) continue;
    const { seeds, unknown = [], todo } = entry;
    if (todo !== undefined) {
      it.todo(`${variant} programs: ${todo}`);
      continue;
    }
    const expected = new Set(unknown);
    it(`${variant} programs, seeds 1 to ${seeds}: only the known failures fail`, () => {
      const unexpected: string[] = [];
      const fixed = new Set(expected);
      for (let seed = 1; seed <= seeds; seed++) {
        const failure = check(prop, program(seed, variants[variant]));
        if (failure === null) continue;
        fixed.delete(seed);
        if (!expected.has(seed)) unexpected.push(`seed ${seed}: ${failure}`);
      }
      // A seed in `fixed` now passes: take it off the known list.
      expect({ unexpected, fixed: [...fixed] }).toEqual({ unexpected: [], fixed: [] });
    }, 30_000);
  }
}

describe('seek-then-play: seeking back and playing on matches playing straight through', () =>
  guards('seek'));
describe('seek-again: a second seek, with no probe since the first, matches playing straight through', () =>
  guards('again'));
describe('project-behind: projecting to an earlier frame matches what it showed', () =>
  guards('behind'));
describe('project-ahead: projecting from the last call matches playing on', () => guards('ahead'));
describe('project-ahead after a seek back: projecting past the calls the tape holds matches what they showed', () =>
  guards('taped'));
describe('frame spacing: 32 and 48 ms frames match 16 ms frames', () => guards('dt'));
describe('seek by frame: seeking to and reading the first frame at a mix time matches what it showed', () =>
  guards('frame'));
describe('project-now:projecting to the mix’s own time matches what it probes', () =>
  guards('now'));
describe('project-behind with no history: a read back matches what the frame showed, or refuses', () => {
  guards('standing');
  // Where no handle is written to, most reads answer, which the programs above seldom allow.
  it('programs of cues, drops and touches alone, seeds 1 to 1000: every answer matches', () => {
    const before = standing.answered;
    const failures: string[] = [];
    for (let seed = 1; seed <= 1000; seed++) {
      const failure = check('standing', program(seed, { cuesOnly: true }));
      if (failure !== null) failures.push(`seed ${seed}: ${failure}`);
    }
    expect(failures).toEqual([]);
    expect(standing.answered - before).toBeGreaterThan(20_000);
  }, 30_000);
});
