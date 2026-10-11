import { describe, expect, it } from 'vitest';
import { check, type ProgramOptions, type Property, program, standing } from './fuzz/program.js';

const variants = {
  plain: {},
  full: { anchors: true, stateful: true, mixRate: true },
} satisfies Record<string, ProgramOptions>;
type Variant = keyof typeof variants;

/** Seeds 1 to `seeds` are checked; `unknown` lists the ones failing today. */
interface Known {
  seeds: number;
  unknown?: number[];
}

// A seed that starts failing is a regression; `shrink` in ./fuzz/program.ts reduces it to its cause.
const known: Record<Property, Record<Variant, Known>> = {
  seek: { plain: { seeds: 150 }, full: { seeds: 150 } },
  again: { plain: { seeds: 150 }, full: { seeds: 150 } },
  behind: { plain: { seeds: 150 }, full: { seeds: 150 } },
  ahead: { plain: { seeds: 150 }, full: { seeds: 150 } },
  dt: { plain: { seeds: 150 }, full: { seeds: 150 } },
  standing: { plain: { seeds: 150 }, full: { seeds: 150 } },
  now: { plain: { seeds: 150 }, full: { seeds: 150 } },
};

function guards(prop: Property) {
  for (const variant of Object.keys(variants) as Variant[]) {
    const { seeds, unknown = [] } = known[prop][variant];
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
describe('frame spacing: 32 and 48 ms frames match 16 ms frames', () => guards('dt'));
describe('project-now: projecting to the mix’s own time matches what it probes', () =>
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
