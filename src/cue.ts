import { checkHits } from './book.js';
import { changed, index } from './chain.js';
import { schedule } from './due.js';
import { started } from './held.js';
import { handle } from './hosts.js';
import type { Mixer } from './mixer.js';
import { adopt, ownerReading } from './owner.js';
import { durationOf } from './patch.js';
import { checkPlacement, localNow, mixAt, pin, place } from './place.js';
import { motionOwner } from './strays.js';
import type { Channel, Handle, VoiceSpec } from './types.js';
import { Voice } from './voice.js';

export function cue<I, O>(mix: Mixer<I, O>, spec: VoiceSpec<I, O>): Handle<I> {
  const patch = spec.patch;
  for (const channel of patch.writes) {
    if (!(channel in (mix.kit as object)))
      throw new Error(`blits: kit has no channel ${String(channel)}, which this patch writes`);
    const wanted = patch.kit?.[channel] as Channel<unknown> | undefined;
    const here = mix.kit[channel] as Channel<unknown>;
    if (wanted && wanted !== here && (wanted.kind === undefined || wanted.kind !== here.kind))
      throw new Error(
        `blits: channel ${String(channel)} is ${here.kind ?? 'a custom channel'} in this kit, but the patch was written for ${wanted.kind ?? 'a custom channel'}`,
      );
  }
  if (patch.reads) {
    const host = mix.opts.host;
    for (const field of patch.reads)
      if (typeof host !== 'object' || host === null || !(field in host))
        throw new Error(`blits: the patch reads host.${field}, which this mix's host lacks`);
  }
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
  const start = anchored
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
  if (owner !== null) adopt(owner, voice);
  if (voice.holding !== null) {
    mix.owners ??= [];
    mix.owners.push(voice);
  }
  if (!Number.isNaN(mix.now)) {
    voice.cuedAt = mix.now;
    voice.opened = mix.now;
  }
  voice.placing = anchored;
  if (mix.pace !== null && owner === null && spec.start !== undefined && voice.state === 'pending')
    pin(mix, voice, spec.start - mix.offset);
  const motion = voice.motion;
  if (motion !== undefined) {
    mix.playing.set(motion, (mix.playing.get(motion) ?? 0) + 1);
    mix.owner ??= motionOwner(new WeakRef(mix));
    motion.owner = mix.owner;
    motion.ownerId = voice.id;
  }
  mix.cued.push(voice);
  index(mix, voice);
  changed(mix, voice);
  mix.stirred = true;
  if (spec.locus !== undefined) mix.loci++;
  if (spec.from === 'current') mix.wantsPose = true;
  if (anchor) {
    mix.anchored++;
    place(mix);
    if (
      !Number.isNaN(mix.now) &&
      voice.state === 'pending' &&
      localNow(mix, voice) >= voice.start
    ) {
      voice.state = 'live';
      started(mix, voice);
      changed(mix, voice);
    }
  }
  // After placing, so the controls it starts with are where its anchors put it at the cue.
  if (mix.opts.history) {
    voice.log = [];
    voice.note(Number.NEGATIVE_INFINITY);
  }
  schedule(mix, voice);
  voice.handle = handle(mix, voice);
  return voice.handle;
}

/** The owner a handle names, refused where it is not one of this mix's or has left. */
function ownerOf<I, O>(mix: Mixer<I, O>, handle: Handle<I>): Voice<I, O> {
  const found = mix.owners?.find((v) => v.handle === handle);
  if (found === undefined)
    throw new Error('blits: owner is not a handle mix.owns returned on this mix');
  if (found.state === 'done') throw new Error('blits: that owner has left the mix');
  return found;
}
