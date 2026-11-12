import type { Mixer } from './mixer.js';
import { Staggers } from './staggers.js';
import type { Voice } from './voice.js';

/**
 * A subject's `stagger` answer as the voice meets it: as asked at cue for a voice naming its
 * subjects; else, under history, the one the live mix gave here before a seek back; else asked now,
 * and kept under history for a seek back to give again.
 */
export function delayOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I): number {
  const known = voice.named?.delays?.get(subject);
  if (known !== undefined) return known;
  const kept = staggersOf(mix, voice);
  if (kept === null) return asked(voice, subject);
  const delay = kept.take(subject) ?? asked(voice, subject);
  kept.give(subject, mix.now, mix.transport.seq, delay, mix.transport.keepsFrom());
  return delay;
}

/**
 * The answer `delayOf` gives at the voice's next meeting of `subject`, without meeting it. With
 * `hold`, one asked now is kept for that meeting to take, so `stagger` is asked once for both.
 */
export function delayAhead<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  hold: boolean,
): number {
  const known = voice.named?.delays?.get(subject);
  if (known !== undefined) return known;
  const kept = voice.staggers;
  const next = kept?.next(subject);
  if (next !== undefined) return next;
  const delay = asked(voice, subject);
  const into = hold ? staggersOf(mix, voice) : null;
  into?.hold(subject, mix.now, mix.transport.seq, delay, mix.transport.keepsFrom());
  return delay;
}

/** A subject's answer from what a gpu side or a read ahead keeps for the voice, else `stagger`'s. */
function asked<I, O>(voice: Voice<I, O>, subject: I): number {
  const a = voice.asked;
  if (a !== null) {
    const d = a.delay(subject);
    if (d !== undefined) return d;
  }
  return voice.spec.stagger ? voice.spec.stagger(subject) : 0;
}

/** The voice's kept answers, made on first need under history; null where a seek can never come. */
function staggersOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): Staggers<I> | null {
  const kept = voice.staggers;
  if (kept !== null) return kept;
  if (mix.projecting || mix.opts.history === undefined || voice.spec.stagger === undefined)
    return null;
  voice.staggers = new Staggers();
  return voice.staggers;
}
