import type { Voice } from './voice.js';

/** A subject's `stagger` answer: as asked at cue for a voice naming its subjects, else asked now. */
export function delayOf<I, O>(voice: Voice<I, O>, subject: I): number {
  const known = voice.named?.delays?.get(subject);
  if (known !== undefined) return known;
  return voice.spec.stagger ? voice.spec.stagger(subject) : 0;
}
