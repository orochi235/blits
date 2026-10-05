import type { Mixer } from './mixer.js';
import type { Named } from './named.js';
import type { Subject, Voice } from './voice.js';

/** The first record of a subject no live voice reaches, so a probe of it still makes one lookup. */
function stub(): Subject<unknown> {
  return {
    reaches: false,
    delay: 0,
    since: 0,
    shown: 0,
    weight: 0,
    rested: false,
    bands: null,
    state: undefined,
    stepped: 0,
    ticks: 0,
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    kept: null,
    voice: null,
    next: null,
    version: Number.NaN,
    loci: null,
    slot: -1,
  };
}

/**
 * The first of this subject's records, linked through every live voice that reaches it. A voice
 * is asked once, through the record it keeps for the subject anyway; a pending one is linked when
 * it goes live, since `target` is asked on first sight, and sight only comes once a voice plays
 * or holds before.
 */
export function chain<I, O>(this: Mixer<I, O>, subject: I, now: number): Subject<unknown> {
  const was = this.chains.get(subject);
  if (was !== undefined && was.version === this.version) return was;
  const slot = was !== undefined ? was.slot : this.lanes !== null ? this.lanes.number(subject) : -1;
  // Where only voices over every subject changed since, those alone are taken off or put on.
  let first =
    was === undefined
      ? undefined
      : this.steps.patch(was.voice === null ? null : was, was.version, (voice) =>
          this.linkable(voice, subject, now, slot),
        );
  if (first === undefined) {
    let prev: Subject<unknown> | null = null;
    first = null;
    const link = (voice: Voice<I, O>) => {
      const held = this.linkable(voice, subject, now, slot);
      if (held === null) return;
      held.voice = voice;
      held.next = null;
      if (prev === null) first = held;
      else prev.next = held;
      prev = held;
    };
    const named = this.naming === 0 ? undefined : this.named.get(subject);
    let j = 0;
    for (const voice of this.general) {
      while (named !== undefined && j < named.length && (named[j] as Voice<I, O>).id < voice.id)
        link(named[j++] as Voice<I, O>);
      link(voice);
    }
    while (named !== undefined && j < named.length) link(named[j++] as Voice<I, O>);
  }
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

/** A voice's record for a subject where its chain links it: the voice plays or holds, and reaches it. */
export function linkable<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  slot: number,
): Subject<unknown> | null {
  const state = voice.state;
  if (state === 'done' || (state === 'pending' && !voice.holdsBefore)) return null;
  const held = this.held(voice, subject, now, slot);
  return held.reaches ? held : null;
}

/** Whether a voice reaches a subject by what its spec says: the subjects it names, or its `target`. */
export function aims<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, subject: I): boolean {
  // A read back to before a subject left still finds it reached.
  const left = voice.parted?.get(subject);
  if (left !== undefined && !(this.now < left)) return false;
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
