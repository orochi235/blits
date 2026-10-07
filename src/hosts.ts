import { Book, type BookHost } from './book.js';
import { numericOf } from './channels.js';
import { crowdable } from './crowd.js';
import { schedule } from './due.js';
import { beginFade, beginRise, fadeSubject } from './fade.js';
import { type HandleHost, VoiceHandle } from './handle.js';
import { noted, remember } from './history.js';
import type { LaneHost } from './lanes.js';
import { hostOf, listed, markOf, readingAt } from './marks.js';
import type { Mixer } from './mixer.js';
import { nextFrame } from './move.js';
import { descendants, ownWeight, signalled } from './owner.js';
import { localNow } from './place.js';
import { reading } from './reading.js';
import { record } from './tape.js';
import type { Booker, BookOptions, Channel, Handle } from './types.js';
import { unreach } from './unreached.js';
import type { Subject, Voice } from './voice.js';

export function book<I, O>(mix: Mixer<I, O>, opts: BookOptions): Booker {
  if (mix.projecting) throw new Error('blits: a projection books nothing');
  const host: BookHost<I, O> = {
    get voices() {
      return mix.cued;
    },
    get timestamp() {
      return mix.last;
    },
    get now() {
      return mix.now;
    },
    hostOf: (t) => hostOf(mix, t),
    readingAt: (timestamp) => readingAt(mix, timestamp - mix.offset),
    endOf: (voice) => markOf(mix, voice, 'end'),
    marks: (from, to) => listed(mix, from, to),
    unhook: (b) => {
      const left = (mix.bookers ?? []).filter((x) => x !== b);
      mix.bookers = left.length === 0 ? null : left;
    },
  };
  const b = new Book(host, opts);
  mix.bookers = [...(mix.bookers ?? []), b];
  return b;
}

export function laneHost<I, O>(mix: Mixer<I, O>): LaneHost<I, O> {
  return {
    get voices() {
      return mix.cued;
    },
    channels: mix.channels,
    names: mix.names,
    clock: mix,
    fits: (voice) => fits(mix, voice),
    meet: (voice, subject, head, slot) => {
      for (let held = head; held !== null; held = held.next) if (held.voice === voice) return held;
      return mix.held(voice, subject, mix.now, slot);
    },
    forgot: (slot) => {
      // Only a voice over every subject keeps bits, and one gone may still be read back.
      for (const voice of mix.general) unreach(voice, slot, false);
      for (const voice of mix.gone) unreach(voice, slot, false);
    },
    passes: (was, w) => mix.passes(was, w),
    naming: (subject) => (mix.naming === 0 ? undefined : mix.named.get(subject)),
    slotOf: (subject) => mix.chains.get(subject)?.slot ?? -1,
    envelope: (voice, since) =>
      voice.owner === null
        ? mix.envelope(voice, mix.now, since)
        : mix.envelope(voice, mix.now, since) * mix.ownedBy(voice, undefined as I),
    parting: (voice, subject) => mix.parting(voice, subject, mix.now),
    ready: (voice, subject, held, elapsed, pass, weight) => {
      mix.prime(voice, held, mix.now, elapsed, pass);
      voice.setting.weight = weight;
      mix.sending.voice = voice;
      mix.sending.subject = subject;
    },
    signal: (voice, subject, held, elapsed, pass, slot) => {
      // A blend member after the first takes the read already made, with no setting to fill.
      const read = voice.blend === null ? Number.NaN : mix.laneRead(voice, slot);
      if (!Number.isNaN(read)) return read;
      mix.prime(voice, held, mix.now, elapsed, pass);
      const kept = reading.kept;
      const base = mix.base(voice, subject, mix.now, held, slot);
      if (reading.kept !== kept && !voice.keeping) stateful(mix, voice);
      return base;
    },
    horizon: (voice, delay) => {
      reading.horizon = mix.horizonFor(voice, delay, mix.now);
    },
    keeps: mix.opts.history !== undefined,
    after: (voice, held) => remember(mix, voice, held),
    kept: (voice) => stateful(mix, voice),
  };
}

/**
 * Whether a voice's patch and spec can run on a lane, its channels aside. A voice whose patch has
 * kept state on a record through `setting.keep` is stateful from then on, and leaves its lane;
 * one that starts keeping partway through may advance that state once for one subject not
 * probed on the frame it starts, which declaring `state` avoids.
 */
export function fits<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): boolean {
  const spec = voice.spec;
  const patch = voice.patch;
  if (voice.keeping) return false;
  if (voice.state === 'pending' && voice.freezesBefore) return false;
  // A fill weighs a voice's owners once for every subject, which a signal on one would not be.
  if (voice.owner !== null && signalled(voice)) return false;
  // A signal reading host input records it per probe under history, which a fill cannot.
  if (typeof spec.weight === 'function' && spec.weight.input && mix.opts.history?.inputs)
    return false;
  // A locus on lanes gathers keys and fn members; a motion member keeps it on the general path.
  if (spec.locus !== undefined && voice.motion !== undefined) return false;
  if (spec.from === 'current') return false;
  // A rest-less channel's band is read on the record `one` folds; crowds, motions and loci fold elsewhere.
  if (
    (voice.motion !== undefined || spec.locus !== undefined || crowdable(voice)) &&
    voice.slots.some((s) => numericOf(mix.channels[s] as Channel<unknown>)?.op === 'last')
  )
    return false;
  if (voice.out?.rest) return false;
  if (patch.state !== undefined || patch.step !== undefined) return false;
  if (mix.opts.history?.inputs && patch.reads !== undefined && patch.reads.length > 0) return false;
  const built = voice.built;
  return (
    built === null ||
    built.tracks.every((t, i) => t.lerp === undefined || t.lerp === voice.lerps[i])
  );
}

/** A voice's patch kept state on a record: it is stateful from now on. */
export function stateful<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  if (voice.keeping) return;
  voice.keeping = true;
  mix.lanes?.invalidate();
}

export function handle<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): Handle<I> {
  mix.handles ??= handleHost(mix);
  return new VoiceHandle(voice, mix.handles);
}

function handleHost<I, O>(mix: Mixer<I, O>): HandleHost<I, O> {
  return {
    nowFor: (voice) => {
      if (Number.isNaN(mix.now)) return voice.start;
      const local = localNow(mix, voice);
      return Number.isFinite(local) ? local : voice.start;
    },
    changed: (voice) => {
      mix.frame = nextFrame();
      noted(mix, voice);
      mix.lanes?.refill();
    },
    // A delta read before an owner's seek, or a hit booked, is not taken as standing after it.
    sought: (voice) => {
      if (voice.holding !== null)
        descendants(voice, (v) => {
          v.seeks++;
          schedule(mix, v);
        });
    },
    fade: (voice, opts) => {
      if (voice.holding !== null && opts !== undefined && ('subject' in opts || opts.at === 'rest'))
        throw new Error('blits: an owner fades as a whole, not by subject or at rest');
      if (opts !== undefined && 'subject' in opts)
        fadeSubject(mix, voice, opts.subject as I, opts.over);
      else beginFade(mix, voice, opts ?? {});
    },
    rise: (voice, opts) => beginRise(mix, voice, opts ?? {}),
    weightOf: (voice, subject) => {
      if (voice.state === 'done') return 0;
      if (voice.holding !== null)
        return ownWeight(voice, mix.now, mix.reducedNow, (o) => mix.ownerBase(o, subject));
      if (voice.laned && mix.lanes !== null) {
        const w = mix.lanes.weightOf(voice.id, mix.chains.get(subject)?.slot ?? -1);
        if (w !== undefined) return w;
      }
      return (voice.subjects.get(subject) as Subject<unknown> | undefined)?.weight ?? 0;
    },
    record: (label, again) => record(mix, label, again),
  };
}
