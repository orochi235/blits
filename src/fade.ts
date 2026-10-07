import { changed } from './chain.js';
import { envelope } from './clock.js';
import { schedule } from './due.js';
import { noted } from './history.js';
import type { Mixer } from './mixer.js';
import type { Motions } from './motion.js';
import { orphan } from './owner.js';
import { startOf } from './place.js';
import { lingers, refit } from './spans.js';
import { unreach } from './unreached.js';
import type { Subject, Voice } from './voice.js';

/** Starts one subject's ramp out of a voice, or takes it out at once for a ramp of 0. */
export function fadeSubject<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  over?: number,
): void {
  if (voice.state === 'done' || voice.parted?.has(subject) || voice.parts?.has(subject)) return;
  mix.stir();
  const ms = mix.reduced ? 0 : (over ?? voice.fade.out ?? 0);
  const at = Number.isNaN(mix.now) ? startOf(voice) : mix.now;
  if (ms === 0) {
    part(mix, voice, subject, at);
    return;
  }
  voice.parts ??= new Map();
  voice.parts.set(subject, { at, over: ms });
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
  voice.parts?.delete(subject);
  if (voice.parts?.size === 0) voice.parts = null;
  voice.parted ??= new Map();
  voice.parted.set(subject, at);
  mix.parters.add(voice);
  forgetIn(mix, voice, subject);
  const motion = voice.motion;
  if (motion !== undefined && asks(mix, motion, voice)) motion.release(subject);
}

/** Brings a subject faded out of a voice back, to be met afresh on its next probe. */
export function unpart<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I): void {
  if (voice.parted?.delete(subject) !== true) return;
  if (voice.parted.size === 0) voice.parted = null;
  forgetIn(mix, voice, subject);
  const slot = mix.chains.get(subject)?.slot ?? -1;
  if (slot >= 0) mix.lanes?.rejoin(slot);
}

/** Drops a voice's record of a subject and relinks the subject's chain without it. */
function forgetIn<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I): void {
  const head = mix.chains.get(subject);
  if (head !== undefined && head.slot >= 0) unreach(voice, head.slot, false);
  const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
  if (held !== undefined) {
    voice.subjects.delete(subject);
    if (held.reaches) voice.seen--;
    if (held.rested) voice.restedCount--;
    if (voice.holder === held) voice.holder = null;
  }
  if (head === undefined) return;
  head.version = Number.NaN;
  mix.relinks++;
  if (voice.laned && head.slot >= 0) mix.lanes?.part(voice.id, head.slot);
  mix.lanes?.refill();
}

export function beginFade<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  opts: { over?: number; at?: 'rest'; deadline?: number },
  at?: number,
): void {
  if (voice.state === 'done' || voice.state === 'fading') return;
  const over = mix.reduced ? 0 : (opts.over ?? voice.fade.out ?? 0);
  // A voice is linked into its subjects' chains once it plays, and a fading one plays.
  if (voice.state === 'pending') changed(mix, voice);
  voice.state = 'fading';
  voice.out = {
    from: 1,
    at: at ?? (Number.isNaN(mix.now) ? startOf(voice) : mix.now),
    over,
    rest: opts.at === 'rest',
    deadline: opts.deadline,
  };
  noted(mix, voice);
  if (opts.at === 'rest') mix.lanes?.invalidate();
  else mix.lanes?.refill();
  if (over === 0 && opts.at !== 'rest') retire(mix, voice, voice.out.at);
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
  voice.out = null;
  voice.outAt = Number.POSITIVE_INFINITY;
  voice.state = 'live';
  voice.back = over > 0 && from < 1 ? { from, at, over } : null;
  noted(mix, voice);
  mix.lanes?.refill();
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

/** Removes a voice, recording that it left at `at`, default now. */
/** Whether a motion patch still asks this voice of this mix for its time. */
function asks<I, O>(mix: Mixer<I, O>, motion: Motions<I>, voice: Voice<I, O>): boolean {
  return motion.owner === mix.owner && motion.ownerId === voice.id;
}

export function retire<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, at?: number): void {
  if (voice.holding === null) mix.lanes?.touch(voice);
  const motion = voice.motion;
  if (motion !== undefined && asks(mix, motion, voice)) motion.owner = null;
  voice.state = 'done';
  // The record its setting last wrote to, which a retired voice no longer calls for.
  voice.keepOn = null;
  mix.retired.push(voice);
  voice.doneAt = at ?? (Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now);
  voice.play(false, voice.doneAt);
  voice.resolve();
  // An owner takes what it holds with it, and leaves with its last child.
  if (voice.holding !== null)
    for (const child of [...voice.holding.children])
      if (child.state !== 'done') retire(mix, child, voice.doneAt);
  if (voice.owner !== null) {
    const span = voice.owner;
    const owner = orphan(voice);
    if (owner !== null && !lingers(owner, voice.doneAt)) retire(mix, owner, voice.doneAt);
    else if (span.fitting !== null && span.state !== 'done') refit(mix, span);
  }
}
