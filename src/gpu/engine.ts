import { Mixer } from '../mixer.js';
import type { Mix } from '../types.js';

/** The mixer behind a mix: the mix object is one. Throws for a mix no stock engine made. */
export function mixerOf<I, O>(m: Mix<I, O>): Mixer<I, O> {
  if (!(m instanceof Mixer)) throw new Error('blits: this mix was not made by a stock engine');
  return m as unknown as Mixer<I, O>;
}
