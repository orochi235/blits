import type { Mixer } from './mixer.js';
import type { Run } from './motions.js';
import { type PackedRecord, unpackHeld } from './pack.js';
import { HistoryMiss, type Keys } from './paging.js';
import type { Transport } from './transport.js';
import type { Paged } from './types.js';
import type { Controls, Subject, Voice } from './voice.js';

type Member = Mixer<unknown, unknown>;
type Left = { subject: unknown; at: number; held: Subject<unknown> };

/**
 * Makes memory reach mix time `t` for a seek or read there, from what `prepare` loaded; true where
 * it took records from the store. Throws before anything moves where it cannot.
 */
export function cover(transport: Transport, t: number): boolean {
  if (transport.reaches(t)) return false;
  const pager = transport.pager;
  if (pager === null) throw new Error(`blits: ${t} is older than this mix's history reaches`);
  const loaded = pager.loaded;
  if (loaded === null || loaded.t > t) {
    const last = pager.last;
    throw new HistoryMiss(last?.mix ?? '', last?.stream ?? 'history', t);
  }
  pager.loaded = null;
  unpage(transport, loaded.records);
  transport.floor = loaded.t;
  return true;
}

/** A seek back to `t`: what the store and `prepare` hold after it is from a future the tape makes again. */
export function cut(transport: Transport, t: number, unpaged: boolean): void {
  const pager = transport.pager;
  if (pager === null) return;
  if (unpaged) pager.store.cut(t);
  const loaded = pager.loaded;
  if (loaded !== null) loaded.records = loaded.records.filter((r) => r.at <= t);
}

/** Puts records a store gave back into memory ahead of what it still holds, as if never paged. */
function unpage(transport: Transport, records: readonly Paged[]): void {
  const mixes = new Map<string, Member>();
  for (const m of [...transport.members, ...transport.dropped.map((d) => d.mix)])
    mixes.set(m.name ?? '', m);
  const by = new Map<Member, Paged[]>();
  for (const r of [...records].sort((a, b) => a.at - b.at)) {
    const m = mixes.get(r.mix);
    if (m === undefined) continue;
    const list = by.get(m);
    if (list === undefined) by.set(m, [r]);
    else list.push(r);
  }
  for (const [m, list] of by) unpageMix(m, list);
}

function unpageMix(mix: Member, records: readonly Paged[]): void {
  const voices = new Map<number, Voice<unknown, unknown>>();
  for (const v of [...mix.cued, ...mix.gone]) voices.set(v.id, v);
  const host = records.filter((r) => r.stream === 'host');
  mix.hostLog = before(
    host.map((r) => ({ at: r.at, fields: r.data as Record<string, unknown> })),
    mix.hostLog,
  );
  const byVoice = new Map<number, Paged[]>();
  for (const r of records) {
    if (r.voice === undefined) continue;
    const list = byVoice.get(r.voice);
    if (list === undefined) byVoice.set(r.voice, [r]);
    else list.push(r);
  }
  const keys = mix.keys as Keys;
  for (const [id, list] of byVoice) {
    const voice = voices.get(id);
    if (voice !== undefined) unpageVoice(voice, list, keys);
  }
}

function unpageVoice(voice: Voice<unknown, unknown>, records: readonly Paged[], keys: Keys): void {
  const of = (stream: Paged['stream']) => records.filter((r) => r.stream === stream);
  if (voice.log !== null)
    voice.log = before(
      of('controls').map((r) => r.data as Controls),
      voice.log,
    );
  const left = voice.left ?? [];
  for (const r of of('left')) {
    const subject = keys.subject(r.subject);
    if (!left.some((e) => e.at === r.at && Object.is(e.subject, subject)))
      left.push({ subject, at: r.at, held: unpackHeld(voice, r.data as PackedRecord) });
  }
  left.sort((a, b) => a.at - b.at);
  voice.left = left.length === 0 ? null : left;
  for (const [key, list] of bySubject(of('snap'))) {
    const subject = keys.subject(key);
    for (const [held, snaps] of lives(voice, subject, list))
      held.snaps = before(
        snaps.map((r) => ({ at: r.at, held: unpackHeld(voice, r.data as PackedRecord) })),
        held.snaps ?? [],
      );
  }
  for (const [key, list] of bySubject(of('input'))) {
    const subject = keys.subject(key);
    for (const [held, inputs] of lives(voice, subject, list))
      held.inputs = before(
        inputs.map((r) => ({ at: r.at, value: r.data as number })),
        held.inputs ?? [],
      );
  }
  const motion = voice.motion;
  if (motion === undefined) return;
  for (const r of of('released')) motion.reclaim(keys.subject(r.subject), r.at, r.data as Run);
  for (const [key, list] of bySubject(of('stretch'))) motion.restretch(keys.subject(key), list);
}

function bySubject(records: readonly Paged[]): Map<string | number | undefined, Paged[]> {
  const out = new Map<string | number | undefined, Paged[]>();
  for (const r of records) {
    const list = out.get(r.subject);
    if (list === undefined) out.set(r.subject, [r]);
    else list.push(r);
  }
  return out;
}

/**
 * A subject's records in a voice, each with the paged entries from its life: one ends when the
 * subject leaves the voice, and the record it has now began after its last leaving.
 */
function lives(
  voice: Voice<unknown, unknown>,
  subject: unknown,
  records: readonly Paged[],
): [Subject<unknown>, Paged[]][] {
  const left: Left[] = (voice.left ?? []).filter((e) => Object.is(e.subject, subject));
  const out: [Subject<unknown>, Paged[]][] = [];
  let from = Number.NEGATIVE_INFINITY;
  for (const e of left) {
    out.push([e.held, records.filter((r) => r.at > from && r.at <= e.at)]);
    from = e.at;
  }
  const live = voice.subjects.get(subject);
  if (live !== undefined && live.reaches) out.push([live, records.filter((r) => r.at > from)]);
  return out;
}

/**
 * `loaded`, in time order, ahead of `list`: those older than its first entry, the last of any that
 * share a time, which is the one a read finds.
 */
function before<T extends { at: number }>(loaded: readonly T[], list: T[]): T[] {
  const first = list[0]?.at ?? Number.POSITIVE_INFINITY;
  const out: T[] = [];
  for (const e of loaded) {
    if (!(e.at < first)) continue;
    if (out.length > 0 && (out[out.length - 1] as T).at === e.at) out[out.length - 1] = e;
    else out.push(e);
  }
  return out.length === 0 ? list : [...out, ...list];
}
