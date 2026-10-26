import { near } from './fold.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import { Store } from './store.js';
import type { Subject } from './subject.js';
import type { Channel } from './types.js';
import type { Voice } from './voice.js';

export function atRest<I, O>(this: Mixer<I, O>, subject: I): boolean {
  this.restStamps ??= new Store<I, number>();
  const head = this.linked(subject);
  const laned = this.linkedLaned;
  const lanes = this.lanes as Lanes<I, O>;
  // Every voice on lanes and nothing to clamp: the pose a fold would make is the lanes' values.
  if (laned && this.restsLaned()) {
    const slot = (head as Subject<unknown>).slot;
    if (!lanes.owes(slot)) return lanes.rests(slot);
  }
  // A probe this frame answers for the pose it gave the host.
  const since = (this.restStamps.get(subject) ?? Number.NaN) - 2 * this.restsKey();
  if (since >= 0) return since === 1;
  this.restScratch ??= this.blank();
  const pose = this.foldWith(subject, this.restScratch, head, laned, true) as Record<
    string,
    unknown
  >;
  return this.rests((this.bounded.length === 0 ? pose : this.clamp(pose)) as O);
}

export function rests<I, O>(this: Mixer<I, O>, pose: O): boolean {
  for (let i = 0; i < this.names.length; i++) {
    const channel = this.channels[i] as Channel<unknown>;
    const value = (pose as Record<string, unknown>)[this.names[i] as string];
    if (channel.rest === undefined) {
      if (value !== undefined) return false;
    } else if (!near(value, channel.rest)) return false;
  }
  return true;
}

export function restful<I, O>(this: Mixer<I, O>): boolean {
  // Standing still, a voice changes no pose but by its weight signal, or by an anchor or start
  // that host time may yet reach.
  if (this.pace?.stopped(this.u))
    return this.cued.every(
      (v) =>
        v.state === 'done' ||
        (v.state !== 'pending' &&
          typeof v.spec.weight !== 'function' &&
          v.spec.anchor === undefined),
    );
  return this.cued.every((v) => this.still(v, this.now));
}

/** Whether a voice will change no pose from `now` on, short of a change made to it. */
export function still<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, now: number): boolean {
  if (voice.state === 'done') return true;
  if (voice.state !== 'frozen' && voice.state !== 'live') return false;
  if (typeof voice.spec.weight === 'function' || voice.parts !== null) return false;
  const fadeIn = this.reducedNow ? 0 : (voice.fade.in ?? 0);
  if (fadeIn > 0 && now - this.sinceOf(voice, voice.latest) < fadeIn) return false;
  if (voice.state === 'frozen' || voice.holding !== null) return true;
  const motion = voice.motion;
  return motion !== undefined && voice.elapsedAt(now) >= voice.latest && motion.landed();
}

export function restsLaned<I, O>(this: Mixer<I, O>): boolean {
  return (this.lanes as Lanes<I, O>).whole && this.bounded.length === 0;
}

export function restsKey<I, O>(this: Mixer<I, O>): number {
  if (
    this.frame !== this.restsFrame ||
    this.version !== this.restsVersion ||
    this.relinks !== this.restsRelinks ||
    this.stirs !== this.restsStirs
  ) {
    this.restsEpoch++;
    this.restsFrame = this.frame;
    this.restsVersion = this.version;
    this.restsRelinks = this.relinks;
    this.restsStirs = this.stirs;
  }
  return this.restsEpoch;
}
