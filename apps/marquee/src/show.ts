import type { Handle, Mix, Signal } from '@msb235/blits';
import type { Board, Pose, Subject } from './board';
import { type Layer, type Staged, TEXT, type TextName, type Values, values } from './effects';
import { rasterize } from './font';

/** One message in a program: its text and color, the effect it plays with, and that effect's tuning. */
export interface Step {
  readonly how: TextName;
  readonly text: string;
  readonly hex: number;
  readonly params?: Readonly<Record<string, number>>;
}

/** A step's patch, its stagger, and how long it keeps the sign on the owner's clock. */
export function stage(b: Board, step: Step): Staged {
  const effect = TEXT[step.how];
  return effect.stage(b, rasterize(step.text), step.hex, values(effect, step.params));
}

/** Whether the board has room for a step's effect. */
export const fits = (b: Board, step: Step) => TEXT[step.how].fits?.(b) ?? true;

/**
 * Cues one pass of a program on an owner of its own, each step that fits the board placed on the
 * owner's clock where the one before it ends, and returns the owner, done when the last step is.
 */
export function play(m: Mix<Subject, Pose>, b: Board, steps: readonly Step[]): Handle<Subject> {
  const owner = m.owns({ name: 'program' });
  let at = 0;
  for (const step of steps) {
    if (!fits(b, step)) continue;
    const { patch, stagger, ms } = stage(b, step);
    m.cue({
      owner,
      start: at,
      name: `${step.how} ${step.text}`,
      patch,
      subjects: b.dots,
      ...(stagger && { stagger: (s: Subject) => (s.kind === 'dot' ? stagger(s) : 0) }),
    });
    at += ms;
  }
  return owner;
}

/** Cues a layer looping on its subjects for good, weighted by `weight` (a `level`, say). */
export function cueLayer<P extends Layer['params']>(
  m: Mix<Subject, Pose>,
  b: Board,
  l: Layer<P>,
  weight: number | Signal<Subject>,
  given?: Partial<Values<P>>,
): Handle<Subject> {
  return m.cue({
    name: l.name,
    patch: l.patch(b, values(l, given)),
    subjects: l.on === 'cells' ? b.cells : b.dots,
    loop: true,
    weight,
  });
}
