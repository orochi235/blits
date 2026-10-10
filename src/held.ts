import { schedule } from './due.js';
import { everyoneOf, inherit, sighted } from './everyone.js';
import type { Mixer } from './mixer.js';
import { originOf } from './origin.js';
import { record } from './record.js';
import { unreach, unreached } from './unreached.js';
import type { Subject, Voice } from './voice.js';

/** The record a voice gives every subject it does not reach. */
export function unreachedOf<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  now: number,
): Subject<unknown> {
  const since = this.sinceOf(voice, 0);
  const none = record(voice, false, undefined);
  none.since = since;
  none.shown = this.shownOf(voice, since);
  none.stepped = now;
  none.rebuilt = voice.rebuilds;
  voice.unreached = none;
  return none;
}

/** What this voice holds for this subject, made on first sight with `target` and `stagger` asked once. */
export function held<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  slot: number,
): Subject<unknown> {
  if (voice.sharing) {
    const all = everyoneOf(this, voice);
    if (all !== null) return all;
  }
  if (unreached(voice, slot)) return voice.unreached as Subject<unknown>;
  let held = voice.subjects.get(subject) as Subject<unknown> | undefined;
  if (held !== undefined) return held;
  const now = this.now;
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
  if (this.keys !== null) {
    voice.keyed ??= new Set();
    voice.keyed.add(this.keys.key(subject));
  }
  const delay = voice.spec.stagger ? voice.spec.stagger(subject) : 0;
  const since = this.sinceOf(voice, delay);
  const shown = this.shownOf(voice, since);
  held = record(
    voice,
    true,
    voice.patch.state ? (voice.patch.state(subject) as unknown) : (undefined as unknown),
  );
  held.delay = delay;
  held.since = since;
  held.shown = shown;
  held.stepped = since < now ? since : now;
  held.rebuilt = voice.rebuilds;
  if (this.projecting) {
    held.from = held.stepped;
    held.unknown = this.backward && voice.spec.from === 'current';
  }
  voice.subjects.set(subject, held);
  if (!(since <= now)) {
    voice.early ??= [];
    const early = voice.early;
    // Prunes at each doubling, so records whose origin has passed are not kept to the voice's end.
    if (early.length >= 64 && (early.length & (early.length - 1)) === 0) {
      let kept = 0;
      for (const h of early) if (!(h.since <= now)) early[kept++] = h;
      early.length = kept;
    }
    early.push(held);
  }
  // A subject a voice saw while it shared one record was counted then.
  if (sighted(voice, slot)) inherit(voice, held, slot);
  else voice.seen++;
  if (delay > voice.latest) {
    voice.latest = delay;
    // A later end can take a frozen voice live again.
    if (voice.state === 'frozen') schedule(this, voice);
  }
  return held;
}

/**
 * The mix time the voice clock first read `delay`, or will by its controls now. A stateful voice
 * counts from its last seek that rebuilt state, as its records do.
 */
export function sinceOf<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, delay: number): number {
  const p = voice.patch;
  return originOf(voice, delay, p.state !== undefined || p.step !== undefined || voice.keeping);
}

export function shownOf<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, since: number): number {
  return voice.freezesBefore && voice.opened < since ? voice.opened : since;
}

/**
 * A voice's start or clock moved, or it went live at `now`: the records whose `since` was still
 * ahead count from where its clock now puts them.
 */
export function reorigin<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, now: number): void {
  const early = voice.early;
  if (early === null) return;
  let kept = 0;
  for (const held of early) {
    held.since = mix.sinceOf(voice, held.delay);
    held.shown = mix.shownOf(voice, held.since);
    if (held.ticks === 0 && held.stepped > held.since) held.stepped = held.since;
    if (!(held.since <= now)) early[kept++] = held;
  }
  early.length = kept;
  if (kept === 0) voice.early = null;
  mix.lanes?.reshown(voice.id);
}
