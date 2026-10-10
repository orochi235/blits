import { numericOf } from './channels.js';
import type { Mixer } from './mixer.js';
import { record } from './record.js';
import type { Channel } from './types.js';
import type { Subject, Voice } from './voice.js';

/**
 * Whether a voice can keep one record for every subject, decided when it is cued. A record holds
 * what a voice knows of one subject; where the voice is over every subject with no stagger, keeps
 * no state and writes only channels with a rest, every subject's record would read the same but for
 * the weight last given it, so the voice keeps that by subject number and one record for the rest.
 * It needs lanes for the numbers. What only shows later (a subject faded out of it alone, a fade at
 * rest, state kept through `setting.keep`) turns it back with `unshare`.
 */
export function shares<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): boolean {
  const spec = voice.spec;
  const patch = voice.patch;
  return (
    mix.lanes !== null &&
    !mix.projecting &&
    mix.opts.history === undefined &&
    voice.named === null &&
    spec.target === undefined &&
    spec.stagger === undefined &&
    spec.locus === undefined &&
    spec.anchor === undefined &&
    spec.from !== 'current' &&
    patch.state === undefined &&
    patch.step === undefined &&
    // A host field can change between two probes of one frame, and a record of its own keeps the
    // delta a subject's first probe read.
    (patch.reads === undefined || patch.reads.length === 0) &&
    voice.motion === undefined &&
    voice.owner === null &&
    voice.holding === null &&
    !voice.freezesBefore &&
    voice.slots.every((s) => {
      const channel = mix.channels[s] as Channel<unknown>;
      return channel.rest !== undefined && numericOf(channel)?.op !== 'last';
    })
  );
}

/**
 * A sharing voice's one record, made when a chain first asks; null where its origin is still
 * ahead, which a record of its own per subject follows as the clock moves, so it shares no more.
 */
export function everyoneOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): Subject<unknown> | null {
  if (voice.everyone !== null) return voice.everyone;
  const since = mix.sinceOf(voice, 0);
  if (!(since <= mix.now)) {
    unshare(mix, voice);
    return null;
  }
  const all = record(voice, true, undefined);
  all.since = since;
  all.shown = mix.shownOf(voice, since);
  all.stepped = since;
  all.rebuilt = voice.rebuilds;
  voice.everyone = all;
  return all;
}

/**
 * Whether a record's delta was read for this subject: a record of its own always was; the one a
 * sharing voice keeps for every subject was where its patch is keys, which read no subject, or
 * where this is the subject it was last called for.
 */
export function readFor<I, O>(voice: Voice<I, O>, held: Subject<unknown>, subject: I): boolean {
  return held !== voice.everyone || voice.built !== null || voice.sharedFor === subject;
}

/** Whether a chain has asked a sharing voice about the subject numbered `slot`. */
export function sighted<I, O>(voice: Voice<I, O>, slot: number): boolean {
  const bits = voice.sighted;
  const word = slot >>> 5;
  return (
    bits !== null &&
    slot >= 0 &&
    word < bits.length &&
    ((bits[word] as number) & (1 << (slot & 31))) !== 0
  );
}

/** A chain asks a sharing voice about a subject: counted once, as a record of its own would be. */
export function sight<I, O>(voice: Voice<I, O>, slot: number, cap: number): void {
  let bits = voice.sighted;
  const word = slot >>> 5;
  if (bits === null || word >= bits.length) {
    const grown = new Uint32Array(Math.max(word + 1, (cap >>> 5) + 1));
    if (bits !== null) grown.set(bits);
    voice.sighted = grown;
    bits = grown;
  }
  const bit = 1 << (slot & 31);
  if (((bits[word] as number) & bit) !== 0) return;
  bits[word] = (bits[word] as number) | bit;
  voice.seen++;
}

/** The weight a sharing voice last gave the subject numbered `slot`, 0 where it gave none. */
export function weightAt<I, O>(voice: Voice<I, O>, slot: number): number {
  const weights = voice.weights;
  return weights !== null && slot >= 0 && slot < weights.length ? (weights[slot] as number) : 0;
}

/** Keeps the weight a sharing voice gave the subject numbered `slot`. */
export function weighAt<I, O>(voice: Voice<I, O>, slot: number, w: number, cap: number): void {
  let weights = voice.weights;
  if (weights === null || slot >= weights.length) {
    if (w === 0) return;
    const grown = new Float64Array(Math.max(slot + 1, cap));
    if (weights !== null) grown.set(weights);
    voice.weights = grown;
    weights = grown;
  }
  weights[slot] = w;
}

/** A subject's number was let go of: the next subject to take it is one the voice has not seen. */
export function unsight<I, O>(voice: Voice<I, O>, slot: number): void {
  const bits = voice.sighted;
  const word = slot >>> 5;
  if (bits !== null && word < bits.length)
    bits[word] = (bits[word] as number) & ~(1 << (slot & 31));
  const weights = voice.weights;
  if (weights !== null && slot < weights.length) weights[slot] = 0;
}

/**
 * Turns a sharing voice back to a record per subject, made as each is next asked for with the
 * weight kept for it. `keeper` is the subject its one record was just called for and holds kept
 * state of, which takes that record as its own. A lane's positions take their own records now,
 * since each held the one.
 */
export function unshare<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, keeper?: I): void {
  if (!voice.sharing) return;
  voice.sharing = false;
  const all = voice.everyone;
  voice.everyone = null;
  voice.sharedFor = undefined;
  voice.sharedAt = all === null ? Number.NaN : all.probed;
  const at = mix.sharers.indexOf(voice);
  if (at >= 0) mix.sharers.splice(at, 1);
  const slot = keeper === undefined ? -1 : (mix.chains.get(keeper)?.slot ?? -1);
  if (all !== null && sighted(voice, slot)) {
    unsight(voice, slot);
    voice.subjects.set(keeper as I, all);
  } else if (voice.holder === all) voice.holder = null;
  mix.lanes?.rerecord(voice.id, (subject, slot) => mix.held(voice, subject, slot));
  // Every chain links it from here on.
  if (voice.state !== 'done') mix.steps.push(voice, ++mix.version);
  mix.lanes?.refill();
}
