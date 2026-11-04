import type { Mixer } from '../mixer.js';
import { ownersWeight } from '../owner.js';
import { subjectFree } from '../signals.js';
import type { Signal } from '../types.js';
import type { Voice } from '../voice.js';

/**
 * Whether a signal reads the same for every subject, so the gpu side reads it once: only where
 * blits made it so, since a hand-written signal's `length` can't say whether it reads the subject.
 */
export const uniform = (signal: Signal<unknown>): boolean => subjectFree(signal);

/** A uniform signal's read, taken once for every subject. */
export const sampled = (signal: Signal<unknown>): number =>
  (signal as (subject: unknown, setting: unknown) => number)(undefined, undefined);

/** Whether a voice's weight is a signal the kernel reads per subject. */
export function perSubject<I, O>(voice: Voice<I, O>): boolean {
  const w = voice.spec.weight;
  return typeof w === 'function' && !uniform(w as Signal<unknown>);
}

/**
 * A voice's weight before its fade, as the kernel takes it: its number, its uniform signal's read,
 * or 1 where the kernel multiplies each subject's read in. Callers read it once per voice per fold.
 */
export function baseOf<I, O>(voice: Voice<I, O>): number {
  const w = voice.spec.weight;
  if (typeof w !== 'function') return voice.weight;
  return uniform(w as Signal<unknown>) ? sampled(w as Signal<unknown>) : 1;
}

/**
 * What every owner above a voice multiplies into its weight this frame, the same for every subject:
 * only for a voice whose owners' signals are all uniform. Callers read it once per voice per fold.
 */
export function ownedOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): number {
  if (voice.owner === null) return 1;
  return ownersWeight(voice, mix.now, mix.reducedNow, (o) =>
    sampled(o.spec.weight as Signal<unknown>),
  );
}
