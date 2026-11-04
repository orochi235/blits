import { Answers } from '../src/gpu/answers.js';
import { eligibility } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { kit, type Mix, sum } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';

/** The gpu table and eligibility tests' subjects, kit and patch. */
export interface C {
  x: number;
}
export interface P {
  y: number;
}
export const K = kit<P>({ y: sum() });
export const wave = shaderPatch<C, P>(1000, {
  wgsl: 'out.y = phase;',
  at: (phase) => ({ y: phase }),
  writes: ['y'],
});
export const cells = [{ x: 0 }, { x: 1 }];

/**
 * `eligibility` for `m`'s voices over `list`, with an `Answers` registered as the gpu side's is,
 * and the signals its reads refused.
 */
export function elig<O>(
  m: Mix<C, O>,
  list: readonly C[] = cells,
  refused?: WeakMap<object, string>,
) {
  const mixer = mixerOf(m);
  const answers = new Answers<C>(mixer as unknown as Mixer<C, unknown>);
  answers.register(list);
  return eligibility(mixer, answers, refused);
}
