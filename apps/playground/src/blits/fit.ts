import { conclude, condense, type Fit, overrun, pipe, shed } from '@msb235/blits';
import type { FitStep } from './composition';
import type { Compiled } from './expr';

export type FitError = { error: string; line: number | null; step: number };

/** A step list as blits' fit, or the first code step's error. Undefined steps: blits' default. */
export function fitOf(
  steps: FitStep[] | undefined,
  compileCode: (code: string, step: number) => Compiled<Fit>,
): Fit | undefined | FitError {
  if (steps === undefined) return undefined;
  const fits: Fit[] = [];
  for (const [i, s] of steps.entries()) {
    if (s.kind !== 'code') {
      fits.push(stock(s));
      continue;
    }
    const made = compileCode(s.code, i);
    if ('error' in made) return { ...made, step: i };
    fits.push(made.fn);
  }
  return pipe(...fits);
}

function stock(s: Exclude<FitStep, { kind: 'code' }>): Fit {
  switch (s.kind) {
    case 'condense':
      return condense();
    case 'shed':
      return shed();
    case 'conclude':
      return conclude();
    case 'overrun':
      return overrun(s.cap === undefined ? {} : { cap: s.cap });
  }
}
