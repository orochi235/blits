import { schedule } from './due.js';
import type { Mixer } from './mixer.js';
import { mixTime } from './owner.js';
import { unreach, unreached } from './unreached.js';
import type { Subject, Voice } from './voice.js';

/** The record a voice gives every subject it does not reach. */
export function unreachedOf<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  now: number,
): Subject<unknown> {
  const since = this.sinceOf(voice, 0);
  const none: Subject<unknown> = {
    reaches: false,
    delay: 0,
    since,
    shown: this.shownOf(voice, since),
    weight: 0,
    rested: false,
    bands: null,
    state: undefined,
    stepped: now,
    ticks: 0,
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    kept: null,
    voice,
    next: null,
    version: Number.NaN,
    loci: null,
    slot: -1,
    rests: Number.NaN,
  };
  voice.unreached = none;
  return none;
}

/** What this voice holds for this subject, made on first sight with `target` and `stagger` asked once. */
export function held<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  slot: number,
): Subject<unknown> {
  if (unreached(voice, slot)) return voice.unreached as Subject<unknown>;
  let held = voice.subjects.get(subject) as Subject<unknown> | undefined;
  if (held !== undefined) return held;
  const reaches = this.aims(voice, subject);
  if (!reaches) {
    // Nothing is kept for a subject the voice does not reach, so one record stands for them all:
    // a voice per subject reached by `target` held one per subject it was asked about. Where lanes
    // number the subject, a bit by its number says so, where a map entry each grew with voices
    // times subjects.
    const none = voice.unreached ?? this.unreachedOf(voice, now);
    if (slot >= 0 && voice.named === null) unreach(voice, slot, true);
    else voice.subjects.set(subject, none);
    return none;
  }
  const delay = voice.spec.stagger ? voice.spec.stagger(subject) : 0;
  const since = this.sinceOf(voice, delay);
  held = {
    reaches: true,
    delay,
    since,
    shown: this.shownOf(voice, since),
    weight: 0,
    rested: false,
    bands: null,
    state: voice.patch.state ? (voice.patch.state(subject) as unknown) : (undefined as unknown),
    stepped: this.backward && since < now ? since : now,
    ticks: 0,
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    kept: null,
    voice,
    next: null,
    version: Number.NaN,
    loci: null,
    slot: -1,
    rests: Number.NaN,
  };
  if (this.projecting) {
    held.from = held.stepped;
    held.unknown = this.backward && voice.spec.from === 'current';
  }
  voice.subjects.set(subject, held);
  if (voice.state === 'pending') {
    voice.early ??= [];
    voice.early.push(held);
  }
  voice.seen++;
  if (delay > voice.latest) {
    voice.latest = delay;
    // A later end can take a held voice live again.
    if (voice.state === 'held') schedule(this, voice);
  }
  return held;
}

/**
 * When the voice clock reads `delay`, from where it is anchored now; during a ramp this assumes
 * the rate it is ramping to.
 */
export function sinceOf<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, delay: number): number {
  const t =
    voice.rate > 0
      ? voice.anchorNow + (delay - voice.anchorElapsed) / voice.rate
      : voice.start + delay;
  return voice.owner === null ? t : mixTime(voice.owner, t);
}

export function shownOf<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, since: number): number {
  return voice.holdsBefore && voice.opened < since ? voice.opened : since;
}

/** A voice has gone live: the records it made while pending count from where it started. */
export function started<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const early = voice.early;
  if (early === null) return;
  voice.early = null;
  for (const held of early) {
    held.since = mix.sinceOf(voice, held.delay);
    held.shown = mix.shownOf(voice, held.since);
  }
}
