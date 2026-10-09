import { playable } from './cue.js';
import { VoiceHandle } from './handle.js';
import { handle } from './hosts.js';
import type { Mixer } from './mixer.js';
import type { Run } from './motions.js';
import { type PackedRecord, packHeld, unpackHeld } from './pack.js';
import { type Key, type Keys, pageOut } from './paging.js';
import type { Described, VoiceSpec } from './types.js';
import { type Controls, type Ramp, type Rise, Voice } from './voice.js';

/** A voice that has left, as plain data: the descriptor it was cued with, its controls and its records. */
interface PackedVoice {
  as: Described;
  start: number;
  anchorNow: number;
  anchorElapsed: number;
  rate: number;
  ramp: { from: number; to: number; over: number } | null;
  weight: number;
  out: Ramp | null;
  back: Rise | null;
  outAt: number;
  outOver: number;
  outSet: boolean;
  rebuilds: number;
  cuedAt: number;
  doneAt: number;
  opened: number;
  pinned: number;
  latest: number;
  keeping: boolean;
  first: Controls | null;
  log: Controls[] | null;
  played: boolean | undefined;
  playedAt: number;
  records: [Key, PackedRecord][];
  runs: [Key, Run][];
  left: [Key, number, PackedRecord][];
  parts: [Key, number, number][];
  parted: [Key, number][];
}

/**
 * Voices a history store holds whose handles something still holds, by id: a seek that revives
 * one puts it behind its handle, and needs it back if it left after the moment sought.
 */
export class Outs {
  private readonly out = new Map<number, { doneAt: number; handle: WeakRef<object> }>();
  private readonly gone = new FinalizationRegistry<number>((id) => {
    if (this.out.get(id)?.handle.deref() === undefined) this.out.delete(id);
  });

  add(id: number, doneAt: number, h: object): void {
    this.out.set(id, { doneAt, handle: new WeakRef(h) });
    this.gone.register(h, id);
  }

  /** Takes a revived voice's handle back, undefined where none is held. */
  take(id: number): object | undefined {
    const e = this.out.get(id);
    this.out.delete(id);
    return e?.handle.deref();
  }

  /** The id of a voice that left after `t` and that `has` lacks; undefined for none. */
  missing(t: number, has: (id: number) => boolean): number | undefined {
    for (const [id, e] of this.out) if (e.doneAt > t && !has(id)) return id;
    return undefined;
  }
}

/** Whether a voice can leave memory: it was cued with `as`, and nothing else in the mix holds it. */
function pageable<I, O>(voice: Voice<I, O>): boolean {
  return (
    voice.spec.as !== undefined &&
    voice.owner === null &&
    voice.holding === null &&
    voice.blend === null &&
    voice.answers === null &&
    voice.fitting === null
  );
}

/** Pages out a voice that left before `reach`; false for one that has to stay in memory. */
export function pageVoice<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, reach: number): boolean {
  if (!pageable(voice)) return false;
  const keys = mix.keys as Keys;
  const data = packVoice(voice, keys);
  pageOut(mix, 'voice', voice.id, undefined, [{ at: voice.doneAt }], () => data, reach);
  const h = voice.handle as VoiceHandle<I, O>;
  VoiceHandle.page(h, { weight: voice.weight, played: voice.settled.played === true });
  (mix.outs as Outs).add(voice.id, voice.doneAt, h);
  mix.parters.delete(voice);
  return true;
}

function packVoice<I, O>(voice: Voice<I, O>, keys: Keys): PackedVoice {
  const subjectOf = (key: Key) => keys.subject(key) as I;
  const records: [Key, PackedRecord][] = [];
  const runs: [Key, Run][] = [];
  for (const key of voice.keyed ?? []) {
    const subject = subjectOf(key);
    const held = voice.subjects.get(subject);
    if (held?.reaches) records.push([key, packHeld(voice, held)]);
    const run = voice.motion?.pack(subject);
    if (run !== undefined) runs.push([key, run]);
  }
  const settled = voice.settled;
  return {
    as: voice.spec.as as Described,
    start: voice.start,
    anchorNow: voice.anchorNow,
    anchorElapsed: voice.anchorElapsed,
    rate: voice.rate,
    ramp: voice.ramp,
    weight: voice.weight,
    out: voice.out,
    back: voice.back,
    outAt: voice.outAt,
    outOver: voice.outOver,
    outSet: voice.outSet,
    rebuilds: voice.rebuilds,
    cuedAt: voice.cuedAt,
    doneAt: voice.doneAt,
    opened: voice.opened,
    pinned: voice.pinned,
    latest: voice.latest,
    keeping: voice.keeping,
    first: voice.first,
    log: voice.log,
    played: settled.played,
    playedAt: settled.at,
    records,
    runs,
    left: (voice.left ?? []).map((e) => [keys.key(e.subject), e.at, packHeld(voice, e.held)]),
    parts: [...(voice.parts ?? [])].map(([s, r]) => [keys.key(s), r.at, r.over]),
    parted: [...(voice.parted ?? [])].map(([s, at]) => [keys.key(s), at]),
  };
}

/** A voice a history store paged out, rebuilt from its descriptor and put back as it left. */
export function reviveVoice<I, O>(mix: Mixer<I, O>, id: number, d: PackedVoice): Voice<I, O> {
  const revive = mix.opts.history?.revive;
  if (revive === undefined) throw new Error('blits: a paged voice needs history.revive');
  const spec = { ...(revive(d.as) as VoiceSpec<I, O>), as: d.as };
  playable(mix, spec);
  const voice = new Voice<I, O>(
    id,
    spec,
    spec.patch,
    spec.fade ?? {},
    Number.NEGATIVE_INFINITY,
    d.start,
    mix.slotOf,
    mix.channels,
    mix.opts.host,
    mix.send,
    null,
  );
  voice.anchorNow = d.anchorNow;
  voice.anchorElapsed = d.anchorElapsed;
  voice.rate = d.rate;
  voice.ramp = d.ramp;
  voice.weight = d.weight;
  voice.out = d.out;
  voice.back = d.back;
  voice.outAt = d.outAt;
  voice.outOver = d.outOver;
  voice.outSet = d.outSet;
  voice.rebuilds = d.rebuilds;
  voice.cuedAt = d.cuedAt;
  voice.doneAt = d.doneAt;
  voice.opened = d.opened;
  voice.pinned = d.pinned;
  voice.latest = d.latest;
  voice.keeping = d.keeping;
  voice.first = d.first;
  voice.log = d.log;
  voice.state = 'done';
  if (d.played !== undefined) voice.play(d.played, d.playedAt);
  voice.resolve();
  const keys = mix.keys as Keys;
  const subjectOf = (key: Key) => keys.subject(key) as I;
  voice.keyed = new Set();
  for (const [key, p] of d.records) {
    voice.subjects.set(subjectOf(key), unpackHeld(voice, p));
    voice.keyed.add(key);
  }
  for (const [key, run] of d.runs) voice.motion?.unpack(subjectOf(key), run);
  if (d.left.length > 0)
    voice.left = d.left.map(([key, at, p]) => ({
      subject: subjectOf(key),
      at,
      held: unpackHeld(voice, p),
    }));
  if (d.parts.length > 0)
    voice.parts = new Map(d.parts.map(([key, at, over]) => [subjectOf(key), { at, over }]));
  if (d.parted.length > 0)
    voice.parted = new Map(d.parted.map(([key, at]) => [subjectOf(key), at]));
  const h = mix.outs?.take(id) as VoiceHandle<I, O> | undefined;
  if (h === undefined) voice.handle = handle(mix, voice);
  else {
    VoiceHandle.rehome(h, voice);
    voice.handle = h;
  }
  return voice;
}

export type { PackedVoice };
