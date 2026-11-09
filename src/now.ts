import type { Mixer } from './mixer.js';
import { startOf } from './place.js';
import type { Voice } from './voice.js';

/** The mix's time, or before its first frame, the voice's start, where what it does then lands. */
export function nowFor<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): number {
  return Number.isNaN(mix.now) ? startOf(voice) : mix.now;
}

/** The mix's time, or before its first frame, -Infinity, before any time it will read. */
export function nowSoFar<I, O>(mix: Mixer<I, O>): number {
  return Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now;
}
