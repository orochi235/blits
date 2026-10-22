import type { Handle, Mix } from '@msb235/blits';
import {
  type Board,
  HOLD_MS,
  hold,
  type Pose,
  STEP_MS,
  type Subject,
  scroll,
  WIPE_MS,
} from './board';
import { rasterize } from './font';

/** One message in the program: standing still and flashing, or scrolling through. */
export interface Step {
  readonly how: 'hold' | 'scroll';
  readonly text: string;
  readonly hex: number;
}

/** How long a step keeps the sign, on the owner's clock: a held one until its last column wipes off. */
export function length(b: Board, step: Step): number {
  return step.how === 'hold'
    ? HOLD_MS + (b.cols - 1) * WIPE_MS
    : (rasterize(step.text).cols + b.cols) * STEP_MS;
}

/**
 * Cues one pass of the program on an owner of its own, each step placed on the owner's clock where
 * the one before it ends, and returns the owner, done when the last step is.
 */
export function play(m: Mix<Subject, Pose>, b: Board, steps: readonly Step[]): Handle<Subject> {
  const owner = m.owns({ name: 'program' });
  let at = 0;
  for (const step of steps) {
    const text = rasterize(step.text);
    m.cue(
      step.how === 'hold'
        ? {
            owner,
            start: at,
            name: `hold ${step.text}`,
            patch: hold(b, text, step.hex),
            subjects: b.dots,
            stagger: (led) => (led.kind === 'dot' ? led.x * WIPE_MS : 0),
          }
        : {
            owner,
            start: at,
            name: `scroll ${step.text}`,
            patch: scroll(b, text, step.hex),
            subjects: b.dots,
          },
    );
    at += length(b, step);
  }
  return owner;
}
