import { Leavings } from './leavings.js';
import type { Mixer } from './mixer.js';
import type { Run } from './motions.js';
import type { Paced } from './pace.js';
import { type PackedRecord, unpackHeld } from './pack.js';
import { HistoryMiss, type Keys } from './paging.js';
import { type PackedVoice, reviveVoice } from './revive.js';
import { scoredLeft } from './scored.js';
import type { Announced, Transport } from './transport.js';
import type { Paged } from './types.js';
import type { Controls, Subject, Voice } from './voice.js';

type Member = Mixer<unknown, unknown>;

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
  for (const m of [...transport.members, ...transport.dropped.map((d) => d.mix)]) {
    const name = m.name ?? '';
    const id = m.outs?.missing(loaded.t, (v) =>
      loaded.records.some((r) => r.stream === 'voice' && r.voice === v && r.mix === name),
    );
    if (id !== undefined) throw new HistoryMiss(name, 'voice', t);
  }
  pager.loaded = null;
  unpage(transport, loaded.records);
  transport.floor = loaded.t;
  return true;
}

/** A seek back to frame `seq`: what the store and `prepare` hold after it is from a future the tape makes again. */
export function cut(transport: Transport, seq: number): void {
  const pager = transport.pager;
  if (pager === null) return;
  pager.store.cut(seq);
  const loaded = pager.loaded;
  if (loaded !== null) loaded.records = loaded.records.filter((r) => r.seq <= seq);
}

/** Puts records a store gave back into memory ahead of what it still holds, as if never paged. */
function unpage(transport: Transport, records: readonly Paged[]): void {
  unpageTransport(transport, records);
  const mixes = new Map<string, Member>();
  for (const m of [...transport.members, ...transport.dropped.map((d) => d.mix)])
    mixes.set(m.name ?? '', m);
  const by = new Map<Member, Paged[]>();
  for (const r of [...records].sort((a, b) => a.seq - b.seq)) {
    const m = mixes.get(r.mix);
    if (m === undefined) continue;
    const list = by.get(m);
    if (list === undefined) by.set(m, [r]);
    else list.push(r);
  }
  for (const [m, list] of by) unpageMix(m, list);
}

/** The transport's own records: its rate changes, the frames it played and the marks announced on it. */
function unpageTransport(transport: Transport, records: readonly Paged[]): void {
  const own = records.filter((r) => r.mix === '' && r.voice === undefined);
  const paces = own.filter((r) => r.stream === 'pace').map((r) => r.data as Paced);
  if (paces.length > 0) transport.pace?.unshed(paces);
  const frames = own
    .filter((r) => r.stream === 'frame')
    .map((r) => ({ seq: r.seq, at: r.at, u: r.data as number }));
  transport.frames.set(before(frames, transport.frames.all()));
  const held = new Set(transport.announced.map((a) => a.order));
  const marks = own
    .filter((r) => r.stream === 'mark' && !held.has((r.data as Announced).order))
    .map((r) => r.data as Announced);
  if (marks.length > 0)
    transport.announced = [...marks, ...transport.announced].sort((a, b) => a.order - b.order);
}

function unpageMix(mix: Member, records: readonly Paged[]): void {
  const voices = new Map<number, Voice<unknown, unknown>>();
  for (const v of [...mix.cued, ...mix.gone]) voices.set(v.id, v);
  for (const r of records)
    if (r.stream === 'voice' && r.voice !== undefined && !voices.has(r.voice)) {
      const v = reviveVoice(mix, r.voice, r.data as PackedVoice);
      voices.set(v.id, v);
      mix.gone.push(v);
      scoredLeft(mix, v);
    }
  const host = records.filter((r) => r.stream === 'host');
  mix.hostLog = before(
    host.map((r) => ({ at: r.at, seq: r.seq, fields: r.data as Record<string, unknown> })),
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
  const paged = of('left');
  if (paged.length > 0) {
    const left = [...(voice.left?.all() ?? [])];
    for (const r of paged) {
      const subject = keys.subject(r.subject);
      if (left.some((e) => e.seq === r.seq && Object.is(e.subject, subject))) continue;
      const [p, sync] = r.data as [PackedRecord, boolean];
      left.push({ subject, at: r.at, seq: r.seq, sync, held: unpackHeld(voice, p) });
    }
    left.sort((a, b) => a.seq - b.seq);
    voice.left = Leavings.from(left);
  }
  for (const [key, list] of bySubject(of('snap'))) {
    const subject = keys.subject(key);
    for (const [held, snaps] of lives(voice, subject, list))
      held.snaps = before(
        snaps.map((r) => ({
          at: r.at,
          seq: r.seq,
          held: unpackHeld(voice, r.data as PackedRecord),
        })),
        held.snaps ?? [],
      );
  }
  for (const [key, list] of bySubject(of('input'))) {
    const subject = keys.subject(key);
    for (const [held, inputs] of lives(voice, subject, list))
      held.inputs = before(
        inputs.map((r) => ({ at: r.at, seq: r.seq, value: r.data as number })),
        held.inputs ?? [],
      );
  }
  const motion = voice.motion;
  if (motion === undefined) return;
  for (const r of of('released'))
    motion.reclaim(keys.subject(r.subject), r.at, r.seq, r.data as Run);
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
  const left = voice.left?.of(subject) ?? [];
  const out: [Subject<unknown>, Paged[]][] = [];
  let from = Number.NEGATIVE_INFINITY;
  for (const e of left) {
    out.push([e.held, records.filter((r) => r.seq > from && r.seq <= e.seq)]);
    from = e.seq;
  }
  const live = voice.subjects.get(subject);
  if (live?.reaches) out.push([live, records.filter((r) => r.seq > from)]);
  return out;
}

/**
 * `loaded`, in the order it was made, ahead of `list`: those older than its first entry, the last
 * of any that share a frame, which is the one a read finds.
 */
function before<T extends { seq: number }>(loaded: readonly T[], list: T[]): T[] {
  const first = list[0]?.seq ?? Number.POSITIVE_INFINITY;
  const out: T[] = [];
  for (const e of loaded) {
    if (!(e.seq < first)) continue;
    if (out.length > 0 && (out[out.length - 1] as T).seq === e.seq) out[out.length - 1] = e;
    else out.push(e);
  }
  return out.length === 0 ? list : [...out, ...list];
}
