import { foldNumber } from './channels.js';
import { copy as copyValue, first } from './clone.js';
import { open as openRecord, shut as shutRecord, weighAt } from './everyone.js';
import { Per } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Channel } from './types.js';
import type { Subject, Voice } from './voice.js';

export type Key<O> = keyof O & string;

// V8 reads a local const as a constant, where it reads an import from its module on every call.
const copy = copyValue;
const open = openRecord;
const shut = shutRecord;

/** A record's band state, made when a rest-less channel first asks. */
function bandsFor(held: Subject<unknown>, n: number): Uint8Array {
  const bands = new Uint8Array(n);
  held.bands = bands;
  return bands;
}

export function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => near(v, b[i]));
  return a === b;
}

/**
 * `merge(acc, b)`, where a result that is `b` itself, as `last()` gives, is copied into `acc` or a
 * new array: `b` belongs to a patch or the mix's scratch, and a host may edit the pose. `acc` is a
 * value this fold made.
 */
export function merged(channel: Channel<unknown>, acc: unknown, b: unknown): unknown {
  const r = channel.merge(acc, b);
  if (r !== b || !Array.isArray(r)) return r;
  if (!Array.isArray(acc) || acc.length !== r.length) return [...r];
  for (let i = 0; i < r.length; i++) acc[i] = r[i];
  return acc;
}

export type Values = Record<string, unknown>;

/**
 * A record's band state once its voice is skipped at weight 0: off, as `passes` would have said, so
 * a weight that comes back inside the band does not find it still on.
 */
export function unband(held: Subject<unknown> | null | undefined): void {
  if (held?.bands) held.bands.fill(2);
}

/** Whether a rest-less channel's contribution is switched on, across a band rather than an edge. */
export function passes<I, O>(this: Mixer<I, O>, was: boolean | undefined, w: number): boolean {
  const { on, off } = this.band;
  return w >= on ? true : w <= off ? false : (was ?? w >= on);
}

/** Folds one voice's delta into the pose, its band state kept on the subject's record. */
export function apply<I, O>(
  this: Mixer<I, O>,
  pose: Record<string, unknown>,
  voice: Voice<I, O>,
  held: Subject<unknown>,
  delta: Record<string, unknown>,
  weight: number,
): void {
  const slots = voice.slots;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as number;
    const key = this.names[slot] as string;
    const value = delta[key];
    if (value === undefined) continue;
    const op = this.scalars[slot];
    if (op !== undefined && typeof value === 'number') {
      // Called through the channel, `scale` boxes the double it hands `merge`.
      pose[key] = foldNumber(op, pose[key] as number, value, weight);
      continue;
    }
    const channel = this.channels[slot] as Channel<unknown>;
    if (channel.rest !== undefined && channel.scale) {
      // pose[key] is the copy of rest this fold made, so it is ours to write into.
      pose[key] = channel.fold
        ? channel.fold(pose[key], value, weight)
        : merged(channel, pose[key], channel.scale(value, weight));
      continue;
    }
    const bands = held.bands ?? bandsFor(held, slots.length);
    const band = bands[i];
    const on = this.passes(band === 0 ? undefined : band === 1, weight);
    bands[i] = on ? 1 : 2;
    if (on) pose[key] = pose[key] === undefined ? first(value) : merged(channel, pose[key], value);
  }
}

/** Clamps every bounded channel of a folded pose into its range, in place. */
export function clamp<I, O>(
  this: Mixer<I, O>,
  pose: Record<string, unknown>,
): Record<string, unknown> {
  for (const slot of this.bounded) {
    const key = this.names[slot] as string;
    pose[key] = bound(this.channels[slot] as Channel<unknown>, pose[key]);
  }
  return pose;
}

/** A folded value held to its channel's bounds: a number clamped, an array clamped in place. */
export function bound(channel: Channel<unknown>, v: unknown): unknown {
  const [lo, hi] = channel.bounds as readonly [number, number];
  if (typeof v === 'number') return v < lo ? lo : v > hi ? hi : v;
  if (Array.isArray(v))
    for (let i = 0; i < v.length; i++) {
      const x = v[i] as number;
      v[i] = x < lo ? lo : x > hi ? hi : x;
    }
  return v;
}

/**
 * After a fold read a sharing voice for the subject numbered `slot`: keeps the weight it gave and
 * what the read left on its record, and gives the fold's place in `sharers`, which moves back where
 * the read made the voice share no more.
 */
export function shared<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  slot: number,
  rec: Subject<unknown>,
  q: number,
): number {
  if (voice.sharing) {
    // A projection numbers no subject, and keeps nothing by subject.
    if (slot < 0) return q;
    const cap = (this.lanes as Lanes<I, O>).cap;
    weighAt(voice, slot, rec.weight, cap);
    shut(voice, rec, slot, cap);
    return q;
  }
  const sharers = this.sharers;
  let i = 0;
  while (i < sharers.length && (sharers[i] as Voice<I, O>).id < voice.id) i++;
  return i;
}

export function fold<I, O>(
  this: Mixer<I, O>,
  subject: I,
  out?: O,
  dry = false,
  except?: number,
): O {
  const pose = this.folded(subject, out, dry, except) as Record<string, unknown>;
  return (this.bounded.length === 0 ? pose : this.clamp(pose)) as O;
}

export function folded<I, O>(
  this: Mixer<I, O>,
  subject: I,
  out?: O,
  dry = false,
  except?: number,
): O {
  const head = this.linked(subject);
  return this.foldWith(subject, out ?? ({} as O), head, this.linkedLaned, dry, except);
}

/**
 * A subject's chain, linked for this frame, and in `linkedLaned` whether its lanes answer for the
 * voices on them; a subject numbered since the frame's fill folds every voice, laned ones included.
 */
export function linked<I, O>(this: Mixer<I, O>, subject: I): Subject<unknown> | null {
  const head = Number.isNaN(this.now) ? null : this.chain(subject);
  const lanes = this.lanes;
  // What `prepare` answers once this frame's qualify left nothing laned, without calling it.
  if (
    head !== null &&
    lanes !== null &&
    lanes.laned.length === 0 &&
    lanes.frameAt === this.now &&
    lanes.qualifiedVersion === this.version &&
    lanes.touched.length === 0 &&
    !lanes.filling
  ) {
    if (head.slot >= 0) lanes.per[head.slot * Per.SLOT + Per.GENERAL_PROBE] = ++lanes.probes;
    this.linkedLaned = false;
    return head;
  }
  this.linkedLaned =
    head !== null && lanes?.prepare(head.slot, subject, this.version, head) === true;
  return head;
}

/** The fold after a subject's chain is linked and its lanes asked whether it reads from them. */
export function foldWith<I, O>(
  this: Mixer<I, O>,
  subject: I,
  out: O,
  head: Subject<unknown> | null,
  laned: boolean,
  dry: boolean,
  except?: number,
): O {
  const pose = out as Record<string, unknown>;
  const lanes = this.lanes;
  const skip = laned ? (lanes as Lanes<I, O>).copies : null;
  for (let i = 0; i < this.names.length; i++) {
    if (skip?.[i]) continue;
    const channel = this.channels[i] as Channel<unknown>;
    const rest = channel.rest;
    const key = this.names[i] as string;
    // Never `delete`: it drops a reused out object into dictionary mode for good.
    if (rest === undefined) {
      if (pose[key] !== undefined) pose[key] = undefined;
      continue;
    }
    // A stock array channel never keeps the pose's array, so one a last fold left in `out` is ours.
    const held = this.lerpsInto[i] === undefined ? undefined : pose[key];
    if (Array.isArray(held) && held !== rest && held.length === (rest as unknown[]).length) {
      for (let a = 0; a < held.length; a++) held[a] = (rest as unknown[])[a];
    } else pose[key] = channel.copy ? channel.copy(rest) : copy(rest);
  }
  if (head === null) return pose as O;
  // A subject owing lanes it just met folds those voices here, after the lanes' values.
  let owed = -1;
  if (laned) {
    const l = lanes as Lanes<I, O>;
    l.copy(head.slot, pose);
    if (l.owes(head.slot)) owed = head.slot;
    else if (l.whole) return pose as O;
  }
  if (this.detours === 0) {
    const now = this.now;
    for (let held: Subject<unknown> | null = head; held !== null; held = held.next) {
      const voice = held.voice as Voice<I, O> | null;
      if (voice === null || (laned && voice.laned && !this.owedBy(owed, voice))) continue;
      if (voice.id === except || voice.state === 'done') continue;
      const delta = this.read(voice, subject, now, dry, held);
      if (owed >= 0 && voice.laned) (lanes as Lanes<I, O>).paid(voice.id, owed, held.weight);
      if (!(held.weight > 0)) unband(held);
      if (delta === null || this.w <= 0) continue;
      this.apply(pose, voice, held, delta, this.w);
    }
    return pose as O;
  }
  return this.foldDetour(subject, pose, head, laned, dry, except, owed);
}

/**
 * `foldWith`'s voices in a mix with a locus or a voice sharing one record in it. The chain is taken
 * again where a voice stopped sharing since it was linked, as a patch call in this probe's fill can
 * make one do. With no locus, the chain's records fold in voice order, and each voice sharing one
 * record, which is in no chain, before the first chain record that comes after it.
 */
export function foldDetour<I, O>(
  this: Mixer<I, O>,
  subject: I,
  pose: Record<string, unknown>,
  linkedHead: Subject<unknown>,
  laned: boolean,
  dry: boolean,
  except: number | undefined,
  owed: number,
): O {
  const head = linkedHead.version === this.version ? linkedHead : this.chain(subject);
  if (this.loci !== 0) return this.foldLoci(subject, pose, head, laned, dry, except, owed);
  const now = this.now;
  const lanes = this.lanes;
  const sharers = this.sharers;
  let q = 0;
  for (let held: Subject<unknown> | null = head; held !== null; held = held.next) {
    const voice = held.voice as Voice<I, O> | null;
    if (voice === null) continue;
    if (q < sharers.length && (sharers[q] as Voice<I, O>).id < voice.id)
      q = this.foldSharers(pose, subject, head, q, voice.id, laned, dry, except, owed);
    if (laned && voice.laned && !this.owedBy(owed, voice)) continue;
    if (voice.id === except || voice.state === 'done') continue;
    const delta = this.read(voice, subject, now, dry, held);
    if (owed >= 0 && voice.laned) (lanes as Lanes<I, O>).paid(voice.id, owed, held.weight);
    if (!(held.weight > 0)) unband(held);
    if (delta === null || this.w <= 0) continue;
    this.apply(pose, voice, held, delta, this.w);
  }
  if (q < sharers.length)
    this.foldSharers(pose, subject, head, q, Number.MAX_SAFE_INTEGER, laned, dry, except, owed);
  return pose as O;
}

/**
 * Folds the voices sharing one record from `sharers[q]` up to the first whose id is `before` or
 * more, as `foldWith` folds a chain's records, and gives the place it stopped at.
 */
export function foldSharers<I, O>(
  this: Mixer<I, O>,
  pose: Record<string, unknown>,
  subject: I,
  head: Subject<unknown>,
  q: number,
  before: number,
  laned: boolean,
  dry: boolean,
  except: number | undefined,
  owed: number,
): number {
  const sharers = this.sharers;
  const now = this.now;
  while (q < sharers.length) {
    const voice = sharers[q] as Voice<I, O>;
    if (voice.id >= before) break;
    q++;
    const rec = voice.state === 'pending' ? null : voice.everyone;
    if (rec === null) continue;
    if (laned && voice.laned && !this.owedBy(owed, voice)) continue;
    if (voice.id === except || voice.state === 'done') continue;
    open(voice, rec, head.slot);
    const delta = this.read(voice, subject, now, dry, rec);
    if (owed >= 0 && voice.laned) (this.lanes as Lanes<I, O>).paid(voice.id, owed, rec.weight);
    q = this.shared(voice, head.slot, rec, q);
    if (delta === null || this.w <= 0) continue;
    this.apply(pose, voice, rec, delta, this.w);
  }
  return q;
}

/** Whether the subject numbered `owed` reads laned `voice` from the general path this fill. */
export function owedBy<I, O>(this: Mixer<I, O>, owed: number, voice: Voice<I, O>): boolean {
  return owed >= 0 && (this.lanes as Lanes<I, O>).owesVoice(owed, voice.id);
}
