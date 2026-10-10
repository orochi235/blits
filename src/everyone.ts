import { numericOf } from './channels.js';
import type { Mixer } from './mixer.js';
import { record } from './record.js';
import type { Channel } from './types.js';
import type { Subject, Voice } from './voice.js';

/**
 * Whether a voice can keep one record for every subject, decided when it is cued. A record holds
 * what a voice knows of one subject; where the voice is over every subject with no stagger, keeps
 * no state, weighs every subject alike and writes only channels with a rest, a subject's record
 * differs from another's only in the weight last given it and in what its patch was last called
 * for it. The voice keeps those by subject number (`weights`, and for a patch that is called,
 * `stamps` and `deltas`) and one record, `everyone`, that `open` points at a subject before a read
 * and `shut` takes back after. About 32 B a subject where a record and its place in the voice's
 * store took about 370 (bench/allocs.mjs on the `swap` row, 2026-10-09). It needs lanes for the
 * numbers. What only shows later (a subject faded out of it alone, a fade at rest, state kept
 * through `setting.keep`) turns it back with `unshare`.
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
    typeof spec.weight !== 'function' &&
    patch.state === undefined &&
    patch.step === undefined &&
    voice.motion === undefined &&
    voice.owner === null &&
    voice.holding === null &&
    voice.blend === null &&
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

/** Where a subject's two numbers sit in `stamps`: the `now` and the `seeks` of its last read. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package
const enum Stamp {
  SIZE = 2,
  PROBED = 0,
  SEEKS = 1,
}

/**
 * Points a sharing voice's record at the subject numbered `slot` before a read: it holds when the
 * voice's patch was last called for that subject and the delta it gave, as a record of the
 * subject's own would, so the patch is called once a frame for a subject however its probes fall
 * among other subjects'. A keys voice reads no subject, so its record needs no pointing.
 */
export function open<I, O>(voice: Voice<I, O>, rec: Subject<unknown>, slot: number): void {
  if (voice.built !== null) return;
  const stamps = voice.stamps;
  const o = slot * Stamp.SIZE;
  if (stamps === null || o >= stamps.length) {
    rec.probed = Number.NaN;
    rec.seeks = 0;
    rec.delta = null;
    return;
  }
  const at = stamps[o + Stamp.PROBED] as number;
  rec.probed = at;
  rec.seeks = stamps[o + Stamp.SEEKS] as number;
  // A subject never read holds no delta, and its place in `deltas` may never have been written.
  rec.delta = Number.isNaN(at)
    ? null
    : ((voice.deltas as Subject<unknown>['delta'][])[slot] ?? null);
}

/** Takes back what a read left on a sharing voice's record for the subject numbered `slot`. */
export function shut<I, O>(
  voice: Voice<I, O>,
  rec: Subject<unknown>,
  slot: number,
  cap: number,
): void {
  if (voice.built !== null) return;
  let stamps = voice.stamps;
  const o = slot * Stamp.SIZE;
  if (stamps === null || o >= stamps.length) {
    if (Number.isNaN(rec.probed)) return;
    const grown = new Float64Array(Math.max(slot + 1, cap) * Stamp.SIZE).fill(Number.NaN);
    if (stamps !== null) grown.set(stamps);
    voice.stamps = grown;
    stamps = grown;
    voice.deltas ??= [];
  }
  stamps[o + Stamp.PROBED] = rec.probed;
  stamps[o + Stamp.SEEKS] = rec.seeks;
  (voice.deltas as Subject<unknown>['delta'][])[slot] = rec.delta;
}

/** Makes stale what a sharing voice last read for the subject numbered `slot`, as `touch` asks. */
export function restamp<I, O>(voice: Voice<I, O>, slot: number): void {
  const stamps = voice.stamps;
  const o = slot * Stamp.SIZE;
  if (stamps !== null && slot >= 0 && o < stamps.length) stamps[o + Stamp.SEEKS] = -1;
  // A keys voice's one record holds its one delta.
  if (voice.built !== null && voice.everyone !== null) voice.everyone.seeks = -1;
}

/** A subject's number was let go of: the next subject to take it is one the voice has not seen. */
export function unsight<I, O>(voice: Voice<I, O>, slot: number): void {
  const bits = voice.sighted;
  const word = slot >>> 5;
  if (bits !== null && word < bits.length)
    bits[word] = (bits[word] as number) & ~(1 << (slot & 31));
  const weights = voice.weights;
  if (weights !== null && slot < weights.length) weights[slot] = 0;
  const stamps = voice.stamps;
  const o = slot * Stamp.SIZE;
  if (stamps !== null && o < stamps.length) {
    stamps[o + Stamp.PROBED] = Number.NaN;
    (voice.deltas as Subject<unknown>['delta'][])[slot] = null;
  }
}

/**
 * Turns a sharing voice back to a record per subject, each made as it is next asked for from what
 * the voice kept for the subject. With `kept`, a call just kept state on its one record, which is
 * open on `keeper`, the subject called for: that subject takes the record as its own. A lane's
 * positions take their own records now, since each held the one.
 */
export function unshare<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  kept = false,
  keeper?: I,
): void {
  if (!voice.sharing) return;
  voice.sharing = false;
  const all = voice.everyone;
  voice.everyone = null;
  const at = mix.sharers.indexOf(voice);
  if (at >= 0) mix.sharers.splice(at, 1);
  const slot = kept ? (mix.chains.get(keeper as I)?.slot ?? -1) : -1;
  // A projection numbers no subject, so its copy's record is the keeper's without being asked.
  if (all !== null && kept && (mix.projecting || sighted(voice, slot))) {
    if (slot >= 0) unsight(voice, slot);
    voice.subjects.set(keeper as I, all);
  } else if (voice.holder === all) voice.holder = null;
  mix.lanes?.rerecord(voice.id, (subject, s) => mix.held(voice, subject, s));
  // Every chain links it from here on.
  if (voice.state !== 'done') mix.steps.push(voice, ++mix.version);
  mix.unshared = true;
  detour(mix);
  mix.lanes?.refill();
}

/**
 * Counts what makes a mix's fold more than a walk of each chain: a locus, a voice sharing one
 * record, a voice that stopped sharing this frame. Called wherever one of the three changes, so
 * `foldWith` asks one number.
 */
export function detour<I, O>(mix: Mixer<I, O>): void {
  mix.detours = mix.loci + mix.sharers.length + (mix.unshared ? 1 : 0);
}

/** Gives a record just made for a subject a sharing voice had seen what the voice kept for it. */
export function inherit<I, O>(voice: Voice<I, O>, held: Subject<unknown>, slot: number): void {
  held.weight = weightAt(voice, slot);
  open(voice, held, slot);
  unsight(voice, slot);
}
