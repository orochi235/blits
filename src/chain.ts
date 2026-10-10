import { everyoneOf, sight } from './everyone.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Named } from './named.js';
import { record } from './record.js';
import type { Subject, Voice } from './voice.js';

/** The first record of a subject no live voice reaches, so a probe of it still makes one lookup. */
function stub(): Subject<unknown> {
  return record(null, false, undefined);
}

/**
 * The first of this subject's records, linked through every live voice that reaches it. A voice
 * is asked once, through the record it keeps for the subject anyway; a pending one is linked when
 * it goes live, since `target` is asked on first sight, and sight only comes once a voice plays
 * or freezes before.
 */
export function chain<I, O>(this: Mixer<I, O>, subject: I): Subject<unknown> {
  const was = this.chains.get(subject);
  return was !== undefined && was.version === this.version ? was : this.relink(subject, was);
}

// Apart from `chain`, which stays small enough for V8 to inline where a probe links.
export function relink<I, O>(
  this: Mixer<I, O>,
  subject: I,
  was: Subject<unknown> | undefined,
): Subject<unknown> {
  const slot = was !== undefined ? was.slot : this.lanes !== null ? this.lanes.number(subject) : -1;
  // Where only voices over every subject changed since, those alone are taken off or put on.
  let first =
    was === undefined
      ? undefined
      : this.steps.patch(was.voice === null ? null : was, was.version, this, subject, slot);
  if (first === undefined) first = linkAll(this, subject, slot);
  const head = first ?? stub();
  head.version = this.version;
  if (was !== undefined && was !== head) {
    head.loci = was.loci;
    was.loci = null;
    head.slot = was.slot;
    was.slot = -1;
  } else if (was === undefined) head.slot = slot;
  if (was !== head) this.chains.set(subject, head);
  return head;
}

/** A subject's chain linked afresh through every voice that reaches it, in voice order. */
function linkAll<I, O>(mix: Mixer<I, O>, subject: I, slot: number): Subject<unknown> | null {
  let first: Subject<unknown> | null = null;
  let prev: Subject<unknown> | null = null;
  const named = mix.naming === 0 ? undefined : mix.named.get(subject);
  let j = 0;
  const general = mix.general;
  for (let i = 0; i <= general.length; i++) {
    const voice = i < general.length ? (general[i] as Voice<I, O>) : null;
    // The voices naming the subject that come before this one, then this one.
    for (;;) {
      const mine = named !== undefined && j < named.length ? (named[j] as Voice<I, O>) : null;
      const next = mine !== null && (voice === null || mine.id < voice.id) ? mine : voice;
      if (next === null) break;
      if (next === mine) j++;
      const held = mix.linkable(next, subject, slot);
      if (held !== null) {
        held.voice = next;
        held.next = null;
        if (prev === null) first = held;
        else prev.next = held;
        prev = held;
      }
      if (next === voice) break;
    }
  }
  return first;
}

/** A voice's record for a subject where its chain links it: the voice plays or freezes, and reaches it. */
export function linkable<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  slot: number,
): Subject<unknown> | null {
  const state = voice.state;
  if (state === 'done' || (state === 'pending' && !voice.freezesBefore)) return null;
  // A voice sharing one record is in no chain: a fold takes it from `sharers` at its place.
  if (voice.sharing && everyoneOf(this, voice) !== null) {
    sight(voice, slot, (this.lanes as Lanes<I, O>).cap);
    return null;
  }
  const held = this.held(voice, subject, slot);
  return held.reaches ? held : null;
}

/** Whether a voice reaches a subject by what its spec says: the subjects it names, or its `target`. */
export function aims<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, subject: I): boolean {
  // A read back to before a subject left still finds it reached.
  const left = voice.parted?.get(subject);
  if (left !== undefined && !(this.now < left.at)) return false;
  if (voice.named !== null) return voice.named.has(subject);
  return voice.spec.target ? voice.spec.target(subject) : true;
}

/**
 * A voice joined or left the list, or started or stopped waiting: the chains it is linked into
 * are relinked, every subject's for a voice over all of them and only its own for one naming
 * its subjects, and lanes take it on or off.
 */
export function changed<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  // An owner is in no chain and on no lane; what it changes in its children, a fill reads afresh.
  if (voice.holding !== null) {
    mix.lanes?.refill();
    return;
  }
  mix.lanes?.touch(voice);
  if (voice.named === null) {
    mix.steps.push(voice, ++mix.version);
    return;
  }
  for (const subject of voice.named) {
    const head = mix.chains.get(subject);
    if (head !== undefined) head.version = Number.NaN;
  }
  mix.relinks++;
}

/** Files a voice under each subject it names, or among the voices that name none. */
export function index<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  if (voice.holding !== null) return;
  if (voice.named === null) {
    mix.general.push(voice);
    if (voice.sharing) {
      const sharers = mix.sharers;
      let i = sharers.length;
      while (i > 0 && (sharers[i - 1] as Voice<I, O>).id > voice.id) i--;
      sharers.splice(i, 0, voice);
    }
    return;
  }
  mix.naming++;
  for (const subject of voice.named) {
    const list = mix.named.get(subject);
    if (list === undefined) mix.named.set(subject, [voice]);
    else list.push(voice);
  }
}

export function unindex<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  mix.naming--;
  for (const subject of voice.named as Named<I>) {
    const list = mix.named.get(subject);
    if (list === undefined) continue;
    const i = list.indexOf(voice);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) mix.named.delete(subject);
  }
}
