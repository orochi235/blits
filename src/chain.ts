import { everyoneOf, sight } from './everyone.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Named } from './named.js';
import { record } from './record.js';
import type { Subject } from './subject.js';
import type { Voice } from './voice.js';

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
  const lanes = this.lanes;
  const slot = was !== undefined ? was.slot : lanes !== null ? lanes.number(subject) : -1;
  // A chain a seek kept for its number alone links afresh, as a subject first seen does.
  const sought = was !== undefined && slot >= 0 && lanes?.renew(slot) === true;
  // Where only voices over every subject changed since, those alone are taken off or put on.
  let first =
    was === undefined || sought
      ? undefined
      : this.steps.patch(was.voice === null ? null : was, was.version, this, subject, slot);
  if (first === undefined) first = linkAll(this, subject, slot, was ?? null);
  const head = first ?? stub();
  head.version = this.version;
  if (was !== undefined && was !== head) {
    if (!sought) head.loci = was.loci;
    was.loci = null;
    was.slot = -1;
  }
  head.slot = slot;
  if (was !== head) this.chains.set(subject, head);
  return head;
}

/**
 * The subject's chain as last linked; undefined where it has none, as for a chain a seek kept only
 * for its number and not linked since, whose records are those from before the seek.
 */
export function headOf<I, O>(mix: Mixer<I, O>, subject: I): Subject<unknown> | undefined {
  const head = mix.chains.get(subject);
  return head !== undefined && head.slot >= 0 && mix.lanes?.sought(head.slot) === true
    ? undefined
    : head;
}

/**
 * A subject's chain linked afresh through every voice that reaches it, in voice order; `was` is its
 * chain as last linked, whose records each voice's store is asked whether it still holds.
 */
function linkAll<I, O>(
  mix: Mixer<I, O>,
  subject: I,
  slot: number,
  was: Subject<unknown> | null,
): Subject<unknown> | null {
  let first: Subject<unknown> | null = null;
  let old = was;
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
      // Taken before linking, which writes over `next`.
      const guess = old !== null && old.voice === next ? old : null;
      if (guess !== null) old = guess.next;
      const held = mix.linkable(next, subject, slot, guess);
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
  guess: Subject<unknown> | null = null,
): Subject<unknown> | null {
  const state = voice.state;
  if (state === 'done' || (state === 'pending' && !voice.freezesBefore)) return null;
  // A voice sharing one record is in no chain: a fold takes it from `sharers` at its place.
  if (voice.sharing && everyoneOf(this, voice) !== null) {
    // A projection numbers no subject, and keeps nothing by subject.
    if (slot >= 0) sight(voice, slot, (this.lanes as Lanes<I, O>).cap);
    return null;
  }
  const held = this.held(voice, subject, slot, guess);
  return held.reaches ? held : null;
}

/** Whether a voice reaches a subject by what its spec says: the subjects it names, or its `target`. */
export function aims<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, subject: I): boolean {
  return aimsAt(voice, subject, this.now);
}

/** As `aims` at mix time `now`, counting a subject as faded out only by frame `seq`. */
function aimsAt<I, O>(
  voice: Voice<I, O>,
  subject: I,
  now: number,
  seq = Number.POSITIVE_INFINITY,
): boolean {
  // A read back to before a subject left still finds it reached.
  const left = voice.parted?.get(subject);
  if (left !== undefined && !(now < left.at) && left.seq <= seq) return false;
  if (voice.named !== null) return voice.named.has(subject);
  return voice.spec.target ? voice.spec.target(subject) : true;
}

/**
 * The record a voice has of a subject now, as a seek or a read back to mix time `now` and frame
 * `seq` takes it: none where it says only that the voice does not reach a subject it reached
 * then, before the subject faded out of it. The subject had no record then, and is met afresh.
 */
export function heldAt<I, O>(
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown> | undefined,
  now: number,
  seq: number,
): Subject<unknown> | undefined {
  return held !== undefined && !held.reaches && aimsAt(voice, subject, now, seq) ? undefined : held;
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
    const head = headOf(mix, subject);
    if (head !== undefined) unlink(mix, head);
  }
  mix.relinks++;
}

/**
 * Makes one subject's chain stale, to be linked again at its next read, and counts it in `relinks`,
 * which its number is stamped with for `pull`.
 */
export function unlink<I, O>(mix: Mixer<I, O>, head: Subject<unknown>): void {
  head.version = Number.NaN;
  const at = ++mix.relinks;
  if (head.slot >= 0 && mix.lanes !== null) mix.lanes.unlinked[head.slot] = at;
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
