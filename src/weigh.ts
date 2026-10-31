import { envelope, weighed } from './clock.js';
import { elapsedThen, last, record } from './history.js';
import { Arg } from './lane.js';
import type { Mixer } from './mixer.js';
import { ownersWeight } from './owner.js';
import { reading } from './reading.js';
import type { VoiceSetting } from './setting.js';
import type { Subject } from './subject.js';
import type { Setting } from './types.js';
import type { Voice } from './voice.js';

/**
 * Where `prime` reads its numbers in `Mixer.primed`: as arguments, each would be boxed wherever V8
 * does not inline the call, which turns on the order its compiles ran (bench/frame.mjs `glow`,
 * 2026-10-20).
 */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package
export const enum Primed {
  NOW = 0,
  ELAPSED = 1,
  PASS = 2,
  SIZE = 3,
}

/** Fills a voice's setting for a call to its patch, the weight aside, from `primed`. */
export function prime<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, held: Subject<unknown>): void {
  const now = this.primed[Primed.NOW] as number;
  const elapsed = this.primed[Primed.ELAPSED] as number;
  const pass = this.primed[Primed.PASS] as number;
  const setting = voice.setting;
  setting.timestamp = now;
  // With no step to move it, `stepped` follows the call before this frame's.
  if (voice.patch.step === undefined && held.probed < now) held.stepped = held.probed;
  setting.dt = this.capped(now - held.stepped);
  setting.elapsed = elapsed;
  setting.pass = pass;
  setting.weight = 0;
  setting.state = held.state;
  setting.mark = 0;
  voice.keepOn = held;
}

/**
 * `prime` for a lane's call, from `arg`: the per-lane fields only where the setting was not
 * already filled under `Arg.MARK`, since nothing but the engine writes a setting.
 */
export function primeLaned<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  held: Subject<unknown>,
  arg: Float64Array,
): void {
  const now = this.now;
  const setting = voice.setting;
  if (setting.mark !== arg[Arg.MARK]) markSetting(setting, now, arg);
  if (voice.patch.step === undefined && held.probed < now) held.stepped = held.probed;
  setting.dt = this.capped(now - held.stepped);
  setting.weight = 0;
  setting.state = held.state;
  voice.keepOn = held;
}

/**
 * `primeLaned`'s once-a-lane fields, kept out of it so it fits `one`'s inlining budget beside
 * `signalled`, which otherwise took its place (`glow^` 4.5% faster, 2026-10-28).
 */
function markSetting<I, O>(setting: VoiceSetting<I, O>, now: number, arg: Float64Array): void {
  setting.timestamp = now;
  setting.elapsed = arg[Arg.ELAPSED] as number;
  setting.pass = arg[Arg.PASS] as number;
  setting.mark = arg[Arg.MARK] as number;
}

/** A gap as a `dt`: Infinity under reduced motion, and no more than `maxDt`. */
export function capped<I, O>(this: Mixer<I, O>, gap: number): number {
  const cap = this.opts.maxDt;
  return this.reducedNow ? Number.POSITIVE_INFINITY : cap !== undefined && gap > cap ? cap : gap;
}

/** The earliest voice time a read may still ask for, for a subject delayed `delay`. */
export function horizonFor<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  delay: number,
  now: number,
): number {
  const history = this.opts.history;
  return history === undefined
    ? Number.POSITIVE_INFINITY
    : elapsedThen(this, voice, now - history.ms) - delay;
}

/** The ramp a voice's own fade envelope applies this frame, 0..1. */
export function fadeOf<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  now: number,
  since: number,
  stop?: number,
): number {
  return envelope(
    voice.fade.in ?? 0,
    voice.out,
    voice.ease,
    this.reducedNow,
    now,
    since,
    voice.back,
    voice.stalls,
    stop,
  );
}

/** What every owner above a voice multiplies into its weight for a subject this frame. */
export function ownedBy<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, subject: I): number {
  return ownersWeight(voice, this.now, this.reducedNow, (o) => this.ownerBase(o, subject));
}

/**
 * An owner's signal read for a subject, once a frame: kept on the owner's record for it, which
 * no fold links, in `phase`, with the frame it was read in `probed`.
 */
export function ownerBase<I, O>(this: Mixer<I, O>, owner: Voice<I, O>, subject: I): number {
  const now = this.now;
  const held = this.held(owner, subject, -1);
  if (held.probed === this.frame) return held.phase;
  const kept = reading.kept;
  // An owner's record keeps a frame in `probed`, not a time, so `prime` leaves its `stepped` be.
  held.probed = Number.NaN;
  const primed = this.primed;
  primed[Primed.NOW] = now;
  primed[Primed.ELAPSED] = owner.elapsedAt(now);
  primed[Primed.PASS] = 0;
  this.prime(owner, held);
  const base = this.base(owner, subject, now, held);
  reading.kept = kept;
  held.stepped = now;
  held.probed = this.frame;
  held.phase = base;
  return base;
}

/** The weight a voice gives a subject this frame, with the setting already filled in. */
export function weigh<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  held: Subject<unknown>,
): number {
  if (voice.owner !== null) return this.weighOwned(voice, subject, now, held);
  const base = this.base(voice, subject, now, held);
  // A subject's own fade out stops its fade in climbing, as the voice's does.
  const parts = voice.parts?.get(subject);
  const fade = this.envelope(voice, now, held.shown, parts?.at);
  return weighed(base, fade, parts === undefined ? 1 : this.parting(voice, subject, now));
}

/** `weigh` for a voice an owner holds, its owners' weight folded into its fade. */
export function weighOwned<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  held: Subject<unknown>,
): number {
  // Its owners first, since a signal on one takes over the setting `base` leaves for the patch.
  const owned = this.ownedBy(voice, subject);
  const base = this.base(voice, subject, now, held);
  const parts = voice.parts?.get(subject);
  const fade = this.envelope(voice, now, held.shown, parts?.at) * owned;
  return weighed(base, fade, parts === undefined ? 1 : this.parting(voice, subject, now));
}

/**
 * A voice's weight for a subject before its fade and ramp: its signal's, or its own number.
 * `slot` is the subject's number when lanes ask.
 */
export function base<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  held: Subject<unknown>,
  slot = -1,
): number {
  this.sending.voice = voice;
  this.sending.subject = subject;
  const signal = typeof voice.spec.weight === 'function' ? voice.spec.weight : null;
  if (signal === null) return voice.weight;
  const was = held.replay && last(held.replay, now, true);
  const base = was
    ? was.value
    : voice.blend === null
      ? signal(subject, voice.setting as Setting)
      : this.blended(voice, subject, held, slot);
  if (signal.input && !was) record(this, voice, subject, held, base);
  return base;
}
