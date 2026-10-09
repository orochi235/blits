import {
  conclude,
  condense,
  type Fit,
  type FitResult,
  keys,
  mix,
  overrun,
  pipe,
  type SpanHints,
  shed,
} from '@msb235/blits';
import { FRAME } from '@pg/blits/compile';
import type { FitStep } from '@pg/blits/composition';
import { compileFit } from '@pg/blits/expr';
import { fitOf } from '@pg/blits/fit';
import { KIT, type Mixed } from '@pg/blits/kit';
import type { Subject } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

const HINTS: SpanHints[] = [{ overlap: true }, { ballast: true }, { faster: 2 }];
const stops = [
  { at: 0, delta: { scale: 1 } },
  { at: 1, delta: { scale: 2 } },
];

/** A 600 ms span holding three 400 ms keys voices, synced to 100 ms. */
function resultOf(fit: Fit | undefined): FitResult {
  const m = mix<Subject, Mixed>(KIT, { stepMs: FRAME });
  m.sync(0);
  const s = m.span({ duration: 600, ...(fit ? { fit } : {}) });
  for (const hints of HINTS) m.cue({ patch: keys(400, stops), loop: false, owner: s, ...hints });
  m.sync(100);
  return s.result;
}

function made(steps: FitStep[]): Fit {
  const fit = fitOf(steps, compileFit);
  if (fit === undefined || 'error' in fit) throw new Error('no fit');
  return fit;
}

const SPAN = { left: 1, budget: 1, priority: 'strong', order: 'queue', share: 0.5 } as const;
const PLAN = { rate: [1], skip: [false], share: 1, allow: 0 };
const KID = {
  natural: 2,
  state: 'pending',
  faster: 1,
  slower: 1,
  overlap: false,
  ballast: false,
  priority: 'weak',
} as const;

describe('fitOf', () => {
  it("is undefined, blits' default, for no steps", () => {
    expect(fitOf(undefined, compileFit)).toBeUndefined();
  });

  it('gives each step list the result its hand-written pipe gives', () => {
    const cases: [FitStep[], Fit][] = [
      [[{ kind: 'condense' }, { kind: 'shed' }], pipe(condense(), shed())],
      [
        [{ kind: 'condense' }, { kind: 'shed' }, { kind: 'overrun', cap: 1.5 }],
        pipe(condense(), shed(), overrun({ cap: 1.5 })),
      ],
      [[{ kind: 'conclude' }], pipe(conclude())],
      [
        [
          {
            kind: 'code',
            code: '(span, kids, plan) => ({ ...plan, rate: plan.rate.map(() => 2) })',
          },
        ],
        pipe((_s, _k, plan) => ({ ...plan, rate: plan.rate.map(() => 2) })),
      ],
    ];
    const results = cases.map(([steps, hand]) => {
      const got = resultOf(made(steps));
      expect(got).toEqual(resultOf(hand));
      return JSON.stringify(got);
    });
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it("names the code step that fails, on the author's line", () => {
    const steps: FitStep[] = [
      { kind: 'shed' },
      { kind: 'code', code: '(span, kids, plan) =>\n  )' },
    ];
    expect(fitOf(steps, compileFit)).toMatchObject({ step: 1, line: 2 });
  });
});

describe('compileFit', () => {
  it('reads plain and layout', () => {
    const c = compileFit(
      '(span, kids) => ({ ...plain(span, kids), allow: layout(span, kids, plain(span, kids)).length })',
    );
    if ('error' in c) throw new Error(c.error);
    expect(c.fn(SPAN, [KID], PLAN)).toEqual({ ...PLAN, allow: 2 });
    expect(c.faults.count).toBe(0);
  });

  it('hands back the plan it was given when it throws, and counts it', () => {
    const c = compileFit('() => { throw new Error("boom"); }');
    if ('error' in c) throw new Error(c.error);
    expect(c.fn(SPAN, [KID], PLAN)).toBe(PLAN);
    expect(c.faults).toEqual({ count: 1, first: 'boom' });
  });
});
