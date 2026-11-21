import { phaseOf } from '@pg/app/PatchPanel';
import { compile } from '@pg/blits/compile';
import type { Voice } from '@pg/blits/composition';
import { describe, expect, it } from 'vitest';
import { comp, group, subjects, voice } from './helpers';

const patch = {
  kind: 'keys',
  period: 1000,
  stops: [
    { at: 0, delta: { turn: 0 } },
    { at: 1, delta: { turn: 90 } },
  ],
} as const;

/** The keys timeline's playhead for voice `a` at score ms `t`. */
const at = (t: number, a: Partial<Voice>, groups?: Parameters<typeof comp>[1]) => {
  const b = compile(comp([voice({ id: 'a', patch, ...a })], groups), subjects, { listed: false });
  b.mix.sync(t);
  return phaseOf(b.handles.get('a')?.elapsed, 1000, a.rate ?? 1);
};

describe("the keys timeline's playhead", () => {
  it('follows the voice from its start', () => {
    expect(at(1300, { start: 200 })).toBeCloseTo(100);
  });

  it('starts where the voice seeks to', () => {
    expect(at(100, { seek: 500 })).toBeCloseTo(600);
  });

  it('runs back from the end at a negative rate', () => {
    expect(at(300, { rate: -1, loop: false })).toBeCloseTo(700);
  });

  it('rests at the end once a voice that does not loop is done', () => {
    expect(at(1500, { loop: false })).toBe(1000);
  });

  it("runs on its owner's clock", () => {
    expect(at(2500, { owner: 'g' }, [group({ id: 'g', start: 2250 })])).toBeCloseTo(250);
  });

  it('is 0 for a voice that is not cued', () => {
    expect(phaseOf(undefined, 1000, 1)).toBe(0);
  });
});
