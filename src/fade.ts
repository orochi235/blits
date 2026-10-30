import { changed, headOf, unlink } from './chain.js';
import { envelope } from './clock.js';
import { schedule } from './due.js';
import { leave, noted, releasing } from './history.js';
import { markOf } from './marks.js';
import type { Mixer } from './mixer.js';
import type { Motions } from './motions.js';
import { type Holding, orphan, ownerReading, plays } from './owner.js';
import { startOf } from './place.js';
import { isRested } from './record.js';
import { scoreTouched } from './scored.js';
import { lingers, refit } from './spans.js';
import type { Left, Parted, Parting, Subject } from './subject.js';
import { unreach } from './unreached.js';
import type { Ramp, Voice } from './voice.js';

/** Starts one subject's ramp out of a voice, or takes it out at once for a ramp of 0. */
export function fadeSubject<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  over?: number,
): void {
  if (voice.state === 'done' || voice.parted?.has(subject) || voice.parts?.has(subject)) return;
  mix.share?.unshare(mix, voice);
  mix.stir();
  const ms = mix.reduced ? 0 : (over ?? voice.fade.out ?? 0);
  const at = Number.isNaN(mix.now) ? startOf(voice) : mix.now;
  if (ms === 0) {
    part(mix, voice, subject, at);
    return;
  }
  voice.parts ??= new Map();
  voice.parts.set(subject, { at, over: ms, seq: mix.transport.seq });
  mix.parters.add(voice);
  schedule(mix, voice);
  mix.lanes?.refill();
}

/** What a subject's own ramp out of a voice leaves of its weight this frame, 0..1. */
export function parting<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
): number {
  const r = voice.parts?.get(subject);
  if (r === undefined) return 1;
  return envelope(0, { at: r.at, over: r.over, rest: false }, voice.ease, this.reducedNow, now, 0);
}

/**
 * Takes a subject out of one voice for good, as of mix time `at`: the voice forgets its record,
 * its lane position and a motion patch's state for it, and reaches it no more.
 */
export function part<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I, at: number): void {
  const ramp = voice.parts?.get(subject);
  voice.parts?.delete(subject);
  if (voice.parts?.size === 0) voice.parts = null;
  voice.parted ??= new Map();
  voice.parted.set(subject, { at, seq: mix.transport.seq, ramp });
  mix.parters.add(voice);
  forgetIn(mix, voice, subject);
  const motion = voice.motion;
  if (motion !== undefined && asks(mix, motion, voice)) motion.release(subject, ...releasing(mix));
}

/** Brings a subject faded out of a voice back, to be met afresh on its next probe. */
export function unpart<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I): void {
  if (voice.parted?.has(subject) !== true) return;
  // `forgetIn` keeps the subject's own record for a read back; without one, keep the voice's.
  if (voice.subjects.get(subject) === undefined) leaveVoice(mix, voice, subject);
  // Left with its parting still on, which a seek back to before this puts back.
  forgetIn(mix, voice, subject);
  voice.parted.delete(subject);
  if (voice.parted.size === 0) voice.parted = null;
  const slot = headOf(mix, subject)?.slot ?? -1;
  if (slot >= 0) mix.lanes?.rejoin(slot);
}

/**
 * Keeps, under history, the record a subject leaves a voice with as it is let go of: for one faded
 * out before the voice met it, a record saying it is not reached.
 */
export function leaveVoice<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I): void {
  const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
  if (held !== undefined || voice.parted?.has(subject) !== true) leave(mix, voice, subject, held);
  else leave(mix, voice, subject, voice.unreached ?? mix.unreachedOf(voice, mix.now));
}

/**
 * Puts back into a voice's fades, or a copy's, those of the subjects that left it after frame `seq`
 * as they stood then: `leave` keeps them, since a drop or a subject brought back forgets them.
 */
export function fadesAt<I>(
  fades: { parts: Map<I, Parting> | null; parted: Map<I, Parted> | null },
  left: readonly Left<I>[],
  seq: number,
): void {
  for (const e of left) {
    const parted = e.parted;
    if (parted !== null && parted.seq <= seq) {
      fades.parted ??= new Map();
      fades.parted.set(e.subject, parted);
      continue;
    }
    const ramp = e.ramp ?? parted?.ramp;
    if (ramp === undefined || ramp === null || ramp.seq > seq) continue;
    fades.parts ??= new Map();
    fades.parts.set(e.subject, ramp);
  }
}

/** Drops a voice's record of a subject and relinks the subject's chain without it. */
function forgetIn<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I): void {
  const head = headOf(mix, subject);
  if (head !== undefined && head.slot >= 0) {
    unreach(voice, head.slot, false);
    // What the voice kept for the subject while it shared one record, which `weightOf` reads.
    mix.share?.unsight(voice, head.slot);
  }
  const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
  if (held !== undefined) {
    leave(mix, voice, subject, held);
    voice.subjects.delete(subject);
    if (held.reaches) voice.seen--;
    if (isRested(held)) voice.restedCount--;
    if (voice.holder === held) voice.holder = null;
  }
  if (head === undefined) return;
  unlink(mix, head);
  if (voice.laned && head.slot >= 0) mix.lanes?.part(voice.id, head.slot);
  mix.lanes?.refill();
}

export function beginFade<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  opts: { over?: number; at?: 'rest'; deadline?: number; back?: boolean; stays?: boolean },
  at?: number,
): void {
  if (voice.state === 'done' || voice.state === 'fading') return;
  const over = mix.reduced ? 0 : (opts.over ?? voice.fade.out ?? 0);
  // A voice is linked into its subjects' chains once it plays, and a fading one plays.
  const waiting = voice.state === 'pending';
  if (waiting) changed(mix, voice);
  // A fade at rest marks each subject's record as it comes to rest, at its next read: one already
  // read this frame is read again, as after `touch`.
  if (opts.at === 'rest') {
    mix.share?.unshare(mix, voice);
    voice.seeks++;
  }
  voice.state = 'fading';
  voice.out = {
    from: 1,
    at: at ?? (Number.isNaN(mix.now) ? startOf(voice) : mix.now),
    over,
    rest: opts.at === 'rest',
    deadline: opts.deadline,
  };
  if (opts.back) voice.out.back = true;
  if (opts.stays) voice.out.stays = true;
  noted(mix, voice);
  // A fade at rest, from a voice's start, or of a voice yet to start takes it off its lane.
  if (opts.at === 'rest' || opts.back || waiting) mix.lanes?.invalidate();
  else mix.lanes?.refill();
  if (over === 0 && opts.at !== 'rest') {
    if (opts.stays) stay(mix, voice, voice.out.at);
    else retire(mix, voice, voice.out.at);
  }
}

/**
 * Keeps a voice faded at the end of its passes with its owner, live and quiet, rather than letting
 * it leave; the owner leaves at `at` if it holds no child still playing.
 */
export function stay<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, at: number): void {
  voice.state = 'live';
  mix.lanes?.refill();
  const owner = voice.owner as Voice<I, O>;
  if (owner.state === 'done') return;
  const now = Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now;
  if (!plays(owner, now) && !lingers(owner, at)) retire(mix, owner, at);
  else if (owner.fitting !== null && !voice.skipped) refit(mix, owner, at);
}

/**
 * Turns a fading voice around: it climbs back from where its fade out had got to, up the same
 * curve, at the whole curve per `over` ms. A fade waiting for rest is taken back at once. A voice
 * not fading is left as it is.
 */
export function beginRise<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  opts: { over?: number },
): void {
  const out = voice.out;
  if (voice.state !== 'fading' && voice.outSet) {
    // A fade set ahead and not begun is taken back, and the weight never moved.
    voice.outAt = Number.POSITIVE_INFINITY;
    voice.outOver = Number.NaN;
    voice.outSet = false;
    noted(mix, voice);
    return;
  }
  if (voice.state !== 'fading' || out === null) return;
  const at = Number.isNaN(mix.now) ? startOf(voice) : mix.now;
  const over = mix.reduced ? 0 : (opts.over ?? voice.fade.in ?? voice.fade.out ?? 0);
  const left = out.rest || out.over === 0 ? 1 : 1 - (at - out.at) / out.over;
  const from = left < 0 ? 0 : left > 1 ? 1 : left;
  // A voice faded before its start waits for it again, as a seek back finds it.
  const waiting =
    Number.isNaN(mix.now) ||
    (voice.owner === null ? at : ownerReading(voice.owner, at)) < voice.start;
  voice.out = null;
  voice.outAt = Number.POSITIVE_INFINITY;
  voice.state = waiting ? 'pending' : 'live';
  voice.back = over > 0 && from < 1 ? { from, at, over } : null;
  if (waiting) changed(mix, voice);
  noted(mix, voice);
  if (waiting) mix.lanes?.invalidate();
  else mix.lanes?.refill();
}

/**
 * Fades a voice out from mix time `at`: ahead, it plays untouched until then and begins its fade
 * exactly there; at or behind now, the fade began then and is partway.
 */
export function fadeAt<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  at: number,
  over: number | undefined,
): void {
  if (voice.state === 'done' || voice.state === 'fading') return;
  const now = Number.isNaN(mix.now) ? startOf(voice) : mix.now;
  if (at <= now) {
    beginFade(mix, voice, { over }, Math.max(startOf(voice), at));
    mix.stir();
    return;
  }
  voice.outAt = at;
  voice.outOver = over ?? Number.NaN;
  voice.outSet = true;
  noted(mix, voice);
}

/**
 * Brings back a voice kept quiet past its passes, its clock back in them by mix time `now`: it
 * climbs from nothing over the fade it left over, from when its clock reached them.
 */
export function rouse<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, now: number): void {
  const out = voice.out as Ramp;
  const edge = out.back === true ? voice.soonest : voice.span + voice.latest;
  const reached = voice.reaches(edge);
  const at = Math.max(out.at + out.over, reached <= now ? reached : now);
  const over = mix.reduced ? 0 : out.over;
  voice.out = null;
  voice.back = over > 0 ? { from: 0, at, over } : null;
  noted(mix, voice);
  mix.lanes?.refill();
}

/** Whether a motion patch still asks this voice of this mix for its time. */
function asks<I, O>(mix: Mixer<I, O>, motion: Motions<I>, voice: Voice<I, O>): boolean {
  return motion.owner === mix.owner && motion.ownerId === voice.id;
}

/** What a child leaving tells its owner of when the owner coasts. */
function leaving<I, O>(mix: Mixer<I, O>, child: Voice<I, O>): void {
  const h = (child.owner as Voice<I, O>).holding as Holding<Voice<I, O>>;
  h.left(child.passed ? markOf(mix, child, 'coast') : undefined, child.doneSeq);
}

/** Removes a voice, recording that it left at `at`, default now. */
export function retire<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, at?: number): void {
  if (voice.holding === null) mix.lanes?.touch(voice);
  const motion = voice.motion;
  if (motion !== undefined && asks(mix, motion, voice)) motion.owner = null;
  voice.state = 'done';
  scoreTouched(mix, voice);
  // The record its setting last wrote to, which a retired voice no longer calls for.
  voice.keepOn = null;
  mix.retired.push(voice);
  const now = Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now;
  voice.doneAt = at ?? now;
  voice.decidedAt = now;
  voice.doneSeq = mix.transport.seq;
  // The frames up to this one showed it, though its fade ended before: it leaves the list now.
  mix.transport.settle();
  voice.play(false, voice.doneAt, voice.doneSeq);
  voice.resolve();
  // An owner takes what it holds with it, and leaves with its last child.
  if (voice.holding !== null)
    for (const child of [...voice.holding.children])
      if (child.state !== 'done') retire(mix, child, voice.doneAt);
  if (voice.owner !== null) {
    const span = voice.owner;
    leaving(mix, voice);
    const owner = orphan(voice, now);
    if (owner !== null && !lingers(owner, voice.doneAt)) retire(mix, owner, voice.doneAt);
    // A child the fit skipped had no time in it, so the rest of the fit stands: fitting again
    // between siblings skipped together would play the ones still to leave.
    else if (span.fitting !== null && span.state !== 'done' && !voice.skipped)
      refit(mix, span, voice.doneAt);
  }
}
