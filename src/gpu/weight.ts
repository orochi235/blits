import type { Mixer } from '../mixer.js';
import { ownersWeight } from '../owner.js';
import { heard, subjectFree } from '../signals.js';
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

/** Each owner's signal read and the `mix.frame` it was read in. */
const ownerReads = new WeakMap<object, { frame: number; read: number }>();

/** An owner's uniform signal read once per `mix.frame`, as `ownerBase` keeps it on the CPU. */
function ownerRead<I, O>(mix: Mixer<I, O>, owner: Voice<I, O>): number {
  const hit = ownerReads.get(owner);
  if (hit !== undefined && hit.frame === mix.frame) return hit.read;
  const read = sampled(owner.spec.weight as Signal<unknown>);
  if (hit === undefined) ownerReads.set(owner, { frame: mix.frame, read });
  else {
    hit.frame = mix.frame;
    hit.read = read;
  }
  return read;
}

/**
 * What every owner above a voice multiplies into its weight this frame, the same for every subject:
 * only for a voice whose owners' signals are all uniform. Callers read it once per voice per fold.
 */
export function ownedOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): number {
  if (voice.owner === null) return 1;
  return ownersWeight(voice, mix.now, mix.reducedNow, (o) => ownerRead(mix, o));
}

/** A voice's `baseOf` and `ownedOf`, read once per fold for its row and its unread check alike. */
export interface Weighs {
  readonly base: number;
  readonly owned: number;
  /**
   * Its fade at `mix.now` times `owned`, as one shared by every subject: for a voice that does not
   * fade each subject in from its own origin. Worked out on first read.
   */
  readonly faded: number;
}

class Weighed<I, O> implements Weighs {
  readonly base: number;
  readonly owned: number;
  private fade: number | undefined;

  constructor(
    private readonly mix: Mixer<I, O>,
    private readonly voice: Voice<I, O>,
  ) {
    this.base = baseOf(voice);
    this.owned = ownedOf(mix, voice);
  }

  get faded(): number {
    if (this.fade === undefined) {
      const { mix, voice } = this;
      const shown = mix.shownOf(voice, mix.sinceOf(voice, 0));
      this.fade = mix.envelope(voice, mix.now, shown) * this.owned;
    }
    return this.fade;
  }
}

export const weighsOf = <I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): Weighs =>
  new Weighed(mix, voice);

/** A voice's weight signal, or null where its weight is a number. */
const signalOf = <I, O>(voice: Voice<I, O>): Signal<unknown> | null =>
  typeof voice.spec.weight === 'function' ? (voice.spec.weight as Signal<unknown>) : null;

/** Why a voice stays on the CPU whose weight signal keeps state per subject. */
export const KEEPS =
  "its weight signal keeps state for each subject, which only the CPU's records hold";

/** Why a voice stays on the CPU whose weight signal sends events. */
export const SENDS = 'its weight signal sends events, which only a probe on the CPU delivers';

/** Why a voice weighted per subject stays on the CPU while `setReads(false)` holds. */
export const COSTS =
  'its weight signal is read per subject, which costs more on the GPU than folding it on the CPU';

let reads = true;

/** Whether the gpu side folds voices weighted per subject: a bench switch, as `setShareFrames` is. */
export function setReads(on: boolean): void {
  reads = on;
}

const isInput = (signal: Signal<unknown>): boolean =>
  (signal as { input?: boolean }).input === true;

/**
 * Why a voice's weight signal, or an owner's above it, keeps the voice on the CPU, or null where
 * the gpu side can read them. `refused` holds the signals the gpu side's own setting could not read:
 * the only sign a signal keeps state, since `voice.keeping` is also set by a patch that keeps it.
 */
export function weightWhy<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  refused?: WeakMap<object, string>,
): string | null {
  const recorded = !!mix.opts.history?.inputs;
  const signal = signalOf(voice);
  if (signal !== null) {
    if (voice.blend !== null)
      return 'it is a member of a blend, whose signal the CPU reads once for every member';
    if (isInput(signal) && recorded)
      return "its weight signal is an input the mix's history records, which a seek plays back";
    if (isInput(signal) && !heard(signal))
      return 'its weight signal reads an input that does not report its changes';
    if (!reads && !uniform(signal)) return COSTS;
    const no = refused?.get(signal);
    if (no !== undefined) return no;
  }
  for (let o = voice.owner; o !== null; o = o.owner) {
    const s = signalOf(o);
    if (s === null) continue;
    // Input checks come first, as for the voice's own: a non-reporting input is never uniform.
    if (isInput(s) && recorded)
      return "an owner above it is weighted by an input the mix's history records, which a seek plays back";
    if (isInput(s) && !heard(s))
      return 'an owner above it is weighted by an input that does not report its changes';
    if (!uniform(s)) return 'an owner above it weighs it by a signal read per subject';
  }
  return null;
}
