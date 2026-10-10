import { envelope, weighed } from './clock.js';
import { elapsedThen, last, record } from './history.js';
import type { Mixer } from './mixer.js';
import { ownersWeight } from './owner.js';
import { reading } from './reading.js';
import type { Setting } from './types.js';
import type { Subject, Voice } from './voice.js';

/** Fills a voice's setting for a call to its patch, the weight aside. */
export function prime<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  held: Subject<unknown>,
  now: number,
  elapsed: number,
  pass: number,
): void {
  const setting = voice.setting;
  setting.timestamp = now;
  setting.dt = this.capped(now - held.stepped);
  setting.elapsed = elapsed;
  setting.pass = pass;
  setting.weight = 0;
  setting.state = held.state;
  voice.keepOn = held;
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
): number {
  return envelope(
    voice.fade.in ?? 0,
    voice.out,
    voice.ease,
    this.reducedNow,
    now,
    since,
    voice.back,
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
  this.prime(owner, held, now, owner.elapsedAt(now), 0);
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
  const fade = this.envelope(voice, now, held.shown);
  return weighed(base, fade, voice.parts === null ? 1 : this.parting(voice, subject, now));
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
  const fade = this.envelope(voice, now, held.shown) * owned;
  return weighed(base, fade, voice.parts === null ? 1 : this.parting(voice, subject, now));
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
