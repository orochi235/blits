import { checkHits } from './book.js';
import { changed } from './chain.js';
import { copyable } from './clone.js';
import { schedule } from './due.js';
import { shares } from './everyone.js';
import { finiteRate, plainWeight, VoiceHandle } from './handle.js';
import { reorigin } from './held.js';
import { handle } from './hosts.js';
import type { Mixer } from './mixer.js';
import { motionOf } from './motion.js';
import { adopt, ownerPatch, ownerReading } from './owner.js';
import { durationOf } from './patch.js';
import { checkPlacement, localNow, mixAt, pin, place } from './place.js';
import { enlist } from './roster.js';
import { scoredAdd } from './scored.js';
import { checkChild, refit } from './spans.js';
import { motionOwner } from './strays.js';
import { record } from './tape.js';
import type { Channel, Handle, Kit, Patch, VoiceSpec } from './types.js';
import { type Controls, Voice } from './voice.js';

export function cue<I, O>(mix: Mixer<I, O>, spec: VoiceSpec<I, O>): Handle<I> {
  const patch = spec.patch;
  playable(mix, spec);
  if (spec.from === 'current' && patch.form !== 'keys')
    throw new Error("blits: from: 'current' needs a keys patch");
  if (spec.subjects !== undefined && spec.target !== undefined)
    throw new Error('blits: a voice takes target or subjects, not both');
  const anchor = spec.anchor;
  const owner = spec.owner === undefined ? null : ownerOf(mix, spec.owner);
  if (anchor) checkPlacement(mix, spec, anchor, owner);
  if (spec.hits !== undefined) checkHits(spec.hits, durationOf(patch));

  const anchored = anchor !== undefined && (anchor.start !== undefined || anchor.in !== undefined);
  // A voice an owner holds is placed on the owner's clock: ms from when it starts.
  const local = owner === null ? mix.now : ownerReading(owner, mix.now);
  const start =
    anchored || owner?.fitting
      ? Number.POSITIVE_INFINITY
      : owner !== null
        ? (spec.start ?? (local > 0 ? local : 0))
        : spec.start !== undefined
          ? mixAt(mix, spec.start - mix.offset)
          : Number.isNaN(mix.now)
            ? 0
            : mix.now;
  const voice = new Voice<I, O>(
    mix.nextId++,
    spec,
    patch,
    spec.fade ?? {},
    local,
    start,
    mix.slotOf,
    mix.channels,
    mix.opts.host,
    mix.send,
    owner,
  );
  if (patch === ownerPatch && mix.fitting !== null) voice.fitting = mix.fitting;
  if (owner?.fitting) checkChild(spec, voice);
  if (mix.pace !== null && owner === null && spec.start !== undefined && voice.state === 'pending')
    voice.pinned = spec.start - mix.offset;
  enter(mix, voice);
  const h = handle(mix, voice) as VoiceHandle<I, O>;
  voice.handle = h;
  // By its handle, so a voice a history store paged out and a seek revived is the one cued again.
  record(mix, 'cue', () => recue(mix, VoiceHandle.voiceOf(h) ?? lost(h)));
  return h;
}

/** Refuses a patch writing a channel `kit` lacks, or holds as another kind than it was written for. */
export function fitsKit<I, O, S, H>(patch: Patch<I, O, S, H>, kit: Kit<O>): void {
  for (const channel of patch.writes) {
    if (!(channel in (kit as object)))
      throw new Error(`blits: kit has no channel ${String(channel)}, which this patch writes`);
    const wanted = patch.kit?.[channel] as Channel<unknown> | undefined;
    const here = kit[channel] as Channel<unknown>;
    const rest = here.rest;
    if (here.fold && !here.copy && typeof rest === 'object' && rest !== null && !copyable(rest))
      throw new Error(
        `blits: channel ${String(channel)} folds into a copy of its rest, which the mix cannot copy; give the channel a copy`,
      );
    if (wanted && wanted !== here && (wanted.kind === undefined || wanted.kind !== here.kind))
      throw new Error(
        `blits: channel ${String(channel)} is ${here.kind ?? 'a custom channel'} in this kit, but the patch was written for ${wanted.kind ?? 'a custom channel'}`,
      );
  }
}

/** Refuses a spec whose patch the mix cannot play, or whose state its history cannot keep. */
export function playable<I, O>(mix: Mixer<I, O>, spec: VoiceSpec<I, O>): void {
  const patch = spec.patch;
  const loop = spec.loop;
  if (typeof loop === 'number' && !(Number.isInteger(loop) && loop >= 1))
    throw new RangeError(`blits: loop takes true, false or a whole number of passes, not ${loop}`);
  if (spec.rate !== undefined) finiteRate(spec.rate);
  if (typeof spec.weight === 'number') plainWeight(spec.weight);
  fitsKit(patch, mix.kit);
  const motion = motionOf<I>(patch);
  if (motion !== undefined) {
    const channel = patch.writes[0] as keyof O;
    const rest = (mix.kit[channel] as Channel<unknown>).rest;
    if (typeof rest === 'number') motion.cuedOn(String(channel), true);
    else if (Array.isArray(rest) || ArrayBuffer.isView(rest)) motion.cuedOn(String(channel), false);
  }
  if (patch.reads) {
    const host = mix.opts.host;
    for (const field of patch.reads)
      if (typeof host !== 'object' || host === null || !(field in host))
        throw new Error(`blits: the patch reads host.${field}, which this mix's host lacks`);
  }
  if (
    mix.transport.pager !== null &&
    (patch.state !== undefined || patch.step !== undefined) &&
    (patch.pack === undefined || patch.unpack === undefined)
  )
    throw new Error(
      "blits: this mix's history has a store, which keeps a stateful patch's state as data; give the patch pack and unpack",
    );
  if (spec.as !== undefined && mix.transport.pager !== null && !mix.opts.history?.revive)
    throw new Error('blits: a voice cued with as needs history.revive to rebuild it from');
}

/** A voice parked by a seek, cued again as the mix plays past its cue, on the handle it had. */
function recue<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const owner = voice.owner;
  if ((owner === null ? mix.now : ownerReading(owner, mix.now)) >= voice.start)
    voice.state = 'live';
  enter(mix, voice);
}

function lost(h: { id: number }): never {
  throw new Error(
    `blits: voice ${h.id} is paged out, and the seek that plays its cue again did not load it`,
  );
}

/** Puts a voice just made, or parked by a seek, into the mix. */
function enter<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const spec = voice.spec;
  const owner = voice.owner;
  const anchor = spec.anchor;
  const anchored = anchor !== undefined && (anchor.start !== undefined || anchor.in !== undefined);
  const motion = voice.motion;
  if (owner !== null) adopt(owner, voice);
  if (!Number.isNaN(mix.now)) {
    voice.cuedAt = mix.now;
    voice.cuedSeq = mix.transport.seq;
    voice.opened = mix.now;
  }
  voice.placing = anchored;
  // A start the host gave by its own clock, where the mix's rate puts it.
  if (!Number.isNaN(voice.pinned) && voice.state === 'pending') pin(mix, voice, voice.pinned);
  if (motion !== undefined) {
    mix.playing.set(motion, (mix.playing.get(motion) ?? 0) + 1);
    mix.owner ??= motionOwner(new WeakRef(mix));
    motion.owner = mix.owner;
    motion.ownerId = voice.id;
  }
  // In id order, which a voice cued again after later ones keeps by going in at its place.
  const cued = mix.cued;
  let i = cued.length;
  while (i > 0 && (cued[i - 1] as Voice<I, O>).id > voice.id) i--;
  cued.splice(i, 0, voice);
  scoredAdd(mix, voice);
  voice.sharing = shares(mix, voice);
  enlist(mix, voice);
  changed(mix, voice);
  mix.stir();
  if (spec.from === 'current') mix.wantsPose = true;
  if (anchor) {
    place(mix);
    if (
      !Number.isNaN(mix.now) &&
      voice.state === 'pending' &&
      localNow(mix, voice) >= voice.start
    ) {
      voice.state = 'live';
      reorigin(mix, voice, mix.now);
      changed(mix, voice);
    }
  }
  if (owner?.fitting) refit(mix, owner);
  // After placing, so the controls it starts with are where its anchors put it at the cue.
  if (mix.opts.history) {
    voice.log = [];
    voice.note(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    voice.first ??= voice.log[0] as Controls;
  }
  schedule(mix, voice);
}

/** The owner a handle names, refused where it is not one of this mix's or has left. */
function ownerOf<I, O>(mix: Mixer<I, O>, handle: Handle<I>): Voice<I, O> {
  const found = mix.owners?.find((v) => v.handle === handle);
  if (found === undefined)
    throw new Error('blits: owner is not a handle mix.owns returned on this mix');
  if (found.state === 'done') throw new Error('blits: that owner has left the mix');
  return found;
}
