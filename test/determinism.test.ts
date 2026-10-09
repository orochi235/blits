import { describe, expect, it } from 'vitest';
import { check, type ProgramOptions, type Property, program } from './fuzz/program.js';

const variants = {
  plain: {},
  full: { anchors: true, stateful: true, mixRate: true },
} satisfies Record<string, ProgramOptions>;
type Variant = keyof typeof variants;

/** Seeds 1 to `seeds` are checked; the rest of the fields list the ones failing today, by cause. */
interface Known {
  seeds: number;
  C?: number[];
  unknown?: number[];
}

// The known failures, by cause. C: a fade-out due before a voice's first live frame is skipped on
// that frame (finding #10 in the 2026-10-09 review). `shrink` in ./fuzz/program.ts reduces a seed
// to its cause.
const known: Record<Property, Record<Variant, Known>> = {
  seek: { plain: { seeds: 150 }, full: { seeds: 150 } },
  behind: { plain: { seeds: 150 }, full: { seeds: 150 } },
  ahead: { plain: { seeds: 150 }, full: { seeds: 150 } },
  dt: {
    plain: { seeds: 150, C: [43, 74] },
    full: { seeds: 150, C: [74, 99] },
  },
};

function guards(prop: Property) {
  for (const variant of Object.keys(variants) as Variant[]) {
    const { seeds, C = [], unknown = [] } = known[prop][variant];
    const expected = new Set([...C, ...unknown]);
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
    });
  }
}

describe('seek-then-play: seeking back and playing on matches playing straight through', () =>
  guards('seek'));
describe('project-behind: projecting to an earlier frame matches what it showed', () =>
  guards('behind'));
describe('project-ahead: projecting from the last call matches playing on', () => guards('ahead'));
describe('frame spacing: 32 and 48 ms frames match 16 ms frames', () => guards('dt'));
