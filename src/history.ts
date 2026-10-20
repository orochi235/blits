import { elapsedWith } from './clock.js';
import { clone, cloneInto } from './clone.js';
import { schedule } from './due.js';
import { Leavings } from './leavings.js';
import type { Mixer } from './mixer.js';
import { packHeld } from './pack.js';
import { pageOut } from './paging.js';
import type { WholeRecord } from './record.js';
import { scoreTouched } from './scored.js';
import { type Cut, within } from './transport.js';
import { type Controls, none, type Snap, type Subject, type Voice } from './voice.js';

/** The last entry taken before `t`, or at it where `inclusive` says so. */
export function last<T extends { at: number }>(
  list: readonly T[],
  t: number,
  inclusive: boolean | ((e: T) => boolean),
): T | undefined {
  return list[lastIndex(list, t, inclusive)];
}

/** Where `last` finds its entry in the list, -1 where it finds none. */
export function lastIndex<T extends { at: number }>(
  list: readonly T[],
  t: number,
  inclusive: boolean | ((e: T) => boolean),
): number {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = list[mid] as T;
    if (e.at < t || (e.at === t && (typeof inclusive === 'function' ? inclusive(e) : inclusive))) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The last entry of a list kept in the order it was made that falls inside `cut`, an entry made
 * before its frame was read counting as `early`.
 */
export function lastWithin<T extends { seq: number; sync?: boolean }>(
  list: readonly T[],
  cut: Cut,
): T | undefined {
  let lo = 0;
  let hi = list.length - 1;
  let found: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = list[mid] as T;
    if (within(cut, e.seq, e.sync)) {
      found = e;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Deep equality over plain data, for telling whether a host field changed. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka)
    if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** A voice's elapsed at an earlier mix time, by the controls it had then. */
export function elapsedThen<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, t: number): number {
  const log = voice.log;
  const c = log === null ? undefined : last(log, t, true);
  return elapsedWith(c ?? voice, voice.owner === null ? t : ownerThen(mix, voice.owner, t));
}

/** What an owner's clock read at an earlier mix time; apart, so `elapsedThen` stays small. */
function ownerThen<I, O>(mix: Mixer<I, O>, owner: Voice<I, O>, t: number): number {
  return elapsedThen(mix, owner, t);
}

/** Records a change to a voice's controls under `history`, and lets go of what it no longer reaches. */
export function noted<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  scoreTouched(mix, voice, true);
  mix.stir();
  schedule(mix, voice);
  const log = voice.log;
  if (log === null) return;
  voice.note(
    Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now,
    mix.transport.seq,
    mix.moving || !mix.looked,
  );
  const reach = mix.now - (mix.opts.history as { ms: number }).ms;
  let drop = 0;
  while (drop + 1 < log.length && (log[drop + 1] as Controls).at <= reach) drop++;
  if (drop > 0) pageOut(mix, 'controls', voice.id, undefined, log.splice(0, drop), copied, reach);
}

const copied = <T extends object>(e: T): T => ({ ...e });

/** Takes off the front of a list kept by time what a read back to `reach` no longer needs. */
function older<T extends { at: number }>(list: T[], reach: number): T[] {
  let n = 0;
  while (n + 1 < list.length && (list[n + 1] as T).at <= reach) n++;
  return n === 0 ? [] : list.splice(0, n);
}

/** A copy of the state a voice's patch keeps for a subject. */
export function copyState<I, O>(voice: Voice<I, O>, state: unknown): unknown {
  const patch = voice.patch;
  return patch.clone ? patch.clone(state) : clone(state);
}

/**
 * A copy of a subject's record that shares nothing a read could change; with `shared`, its state is
 * the record's own, for a copy that takes one of its own before it steps.
 */
export function copyHeld<I, O>(
  voice: Voice<I, O>,
  h: Subject<unknown>,
  shared = false,
): Subject<unknown> {
  const kept = keptOf(h);
  // Every field in `record`'s order, written out: a spread with fields after it costs a third more.
  return unread({
    reaches: h.reaches,
    delay: h.delay,
    since: h.since,
    shown: h.shown,
    weight: h.weight,
    rested: h.rested,
    bands: h.bands === null ? null : h.bands.slice(),
    state: h.state === undefined || shared ? h.state : copyState(voice, h.state),
    stepped: h.stepped,
    ticks: h.ticks,
    probed: h.probed,
    delta: h.delta,
    phase: h.phase,
    seeks: h.seeks,
    rebuilt: h.rebuilt,
    copied: h.copied,
    base: h.base === undefined ? undefined : clone(h.base),
    slope: h.slope === undefined ? undefined : clone(h.slope),
    kept,
    unkept: h.unkept?.map(clone),
    snaps: h.snaps,
    from: h.from,
    unknown: h.unknown,
    inputs: h.inputs,
    replay: h.replay,
    voice: h.voice,
    next: h.next,
    version: h.version,
    loci: h.loci,
    slot: h.slot,
    run: h.run,
    freed: h.freed,
    restored: h.restored,
  } satisfies WholeRecord);
}

/** A copy of what a record keeps through `setting.keep`. */
function keptOf(h: Subject<unknown>): Map<object, unknown> | null {
  if (h.kept === null) return null;
  const kept = new Map<object, unknown>();
  for (const [owner, value] of h.kept) kept.set(owner, clone(value));
  return kept;
}

/**
 * As `copyHeld`, written over `into`, a record nothing else holds, so a copy made in its place
 * leaves nothing new to collect. test/history.test.ts holds this to `copyHeld` field by field.
 */
export function copyHeldInto<I, O>(
  voice: Voice<I, O>,
  h: Subject<unknown>,
  into: Subject<unknown>,
  shared = false,
): Subject<unknown> {
  into.reaches = h.reaches;
  into.delay = h.delay;
  into.since = h.since;
  into.shown = h.shown;
  into.weight = h.weight;
  into.rested = h.rested;
  into.bands = h.bands === null ? null : h.bands.slice();
  into.state = h.state === undefined || shared ? h.state : copyState(voice, h.state);
  into.stepped = h.stepped;
  into.ticks = h.ticks;
  into.rebuilt = h.rebuilt;
  into.copied = h.copied;
  into.base = h.base === undefined ? undefined : clone(h.base);
  into.slope = h.slope === undefined ? undefined : clone(h.slope);
  into.kept = keptOf(h);
  into.unkept = h.unkept?.map(clone);
  into.from = h.from;
  into.unknown = h.unknown;
  into.replay = h.replay;
  into.voice = h.voice;
  into.slot = h.slot;
  into.run = h.run;
  into.freed = h.freed;
  into.restored = h.restored;
  // `probed`, `delta`, `phase`, `seeks`, `snaps`, `inputs`, `next`, `version` and `loci` as
  // `unread` leaves them.
  return unread(into);
}

/**
 * Lets go of what a record holds from its last probe and its place in a chain, as a copy of it
 * starts: a seek puts back a record nothing else holds this way, in place of a copy.
 */
export function unread(h: Subject<unknown>): Subject<unknown> {
  h.probed = Number.NaN;
  h.delta = null;
  h.phase = 0;
  h.seeks = 0;
  h.snaps = undefined;
  h.inputs = undefined;
  h.next = null;
  h.version = Number.NaN;
  h.loci = null;
  return h;
}

/** Under `history` with `inputs`, copies the host fields any voice reads, once a frame, when they changed. */
export function recordHost<I, O>(mix: Mixer<I, O>, now: number): void {
  const log = mix.hostLog;
  const prev = log[log.length - 1];
  const seq = mix.transport.seq;
  if (prev !== undefined && prev.seq === seq) return;
  const host = mix.opts.host as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const v of mix.cued)
    for (const f of v.patch.reads ?? none) if (!(f in fields)) fields[f] = clone(host[f]);
  if (prev !== undefined && same(prev.fields, fields)) return;
  log.push({ at: now, seq, fields });
  const reach = now - (mix.opts.history as { ms: number }).ms;
  pageOut(mix, 'host', undefined, undefined, older(log, reach), (e) => e.fields, reach);
}

/** Under `history` with `inputs`, keeps what an input signal read, each time it changes. */
export function record<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown>,
  value: number,
): void {
  const history = mix.opts.history;
  if (!history?.inputs || mix.projecting) return;
  const inputs = held.inputs ?? [];
  held.inputs = inputs;
  const prev = inputs[inputs.length - 1];
  if (prev !== undefined && (prev.value === value || prev.at === mix.now)) {
    if (prev.at === mix.now) prev.value = value;
    return;
  }
  inputs.push({ at: mix.now, seq: mix.transport.seq, value });
  const reach = mix.now - history.ms;
  const out = older(inputs, reach);
  if (out.length > 0)
    pageOut(mix, 'input', voice.id, mix.keys?.key(subject), out, (e) => e.value, reach);
}

/** How far apart, in mix ms, a record's copies are kept. */
export function apart(history: { readonly every?: number }): number {
  return history.every ?? 200;
}

/** A copy of a record to keep now, written over a spare the latest seek back cut where it has one. */
function snapOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, held: Subject<unknown>): Snap<unknown> {
  const spare = voice.spares?.pop();
  const sole = voice.patch.clone === undefined;
  if (spare === undefined)
    return { at: mix.now, seq: mix.transport.seq, held: copyHeld(voice, held), sole };
  spare.at = mix.now;
  spare.seq = mix.transport.seq;
  const into = spare.held;
  const old = spare.sole === true && sole ? into.state : undefined;
  copyHeldInto(voice, held, into, true);
  const state = held.state;
  into.state =
    state === undefined
      ? state
      : old === undefined
        ? copyState(voice, state)
        : cloneInto(state, old);
  spare.sole = sole;
  return spare;
}

/** Under `history`, keeps a copy of a stateful voice's record for this subject every so often. */
export function remember<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown>,
): void {
  const history = mix.opts.history;
  if (!history || mix.projecting) return;
  if (
    voice.patch.step === undefined &&
    (held.kept === null || held.kept.size === 0) &&
    held.base === undefined
  )
    return;
  const snaps = held.snaps ?? [];
  held.snaps = snaps;
  const prev = snaps[snaps.length - 1];
  if (prev !== undefined && mix.now - prev.at < apart(history)) return;
  snaps.push(snapOf(mix, voice, held));
  const reach = mix.now - history.ms;
  const out = older(snaps, reach);
  if (out.length > 0)
    pageOut(
      mix,
      'snap',
      voice.id,
      mix.keys?.key(subject),
      out,
      (e) => packHeld(voice, e.held),
      reach,
    );
}

/**
 * Under history, keeps the record a subject had when it left a voice, faded out of it or dropped,
 * for a seek or a read back to before then; without history, keeps nothing.
 */
export function leave<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown> | undefined,
): void {
  const history = mix.opts.history;
  if (history === undefined || held === undefined) return;
  const reach = mix.now - history.ms;
  const left = voice.left ?? new Leavings<I>();
  voice.left = left;
  const keys = mix.keys;
  left.expire(
    reach,
    keys === null
      ? null
      : (e) =>
          pageOut(
            mix,
            'left',
            voice.id,
            keys.key(e.subject),
            [e],
            (x) => [packHeld(voice, x.held), x.sync, x.ramp, x.parted],
            reach,
          ),
  );
  left.push({
    subject,
    at: Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now,
    seq: mix.transport.seq,
    sync: mix.syncing || !mix.looked,
    held,
    ramp: voice.parts?.get(subject) ?? null,
    parted: voice.parted?.get(subject) ?? null,
  });
}

/**
 * The mix time a motion patch keeps a released subject from, how far back, and the frame, under
 * history.
 */
export function releasing<I, O>(mix: Mixer<I, O>): [at?: number, reach?: number, seq?: number] {
  const history = mix.opts.history;
  if (history === undefined || Number.isNaN(mix.now)) return [];
  return [mix.now, mix.now - history.ms, mix.transport.seq];
}
