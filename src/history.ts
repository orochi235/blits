import { elapsedWith } from './clock.js';
import { clone } from './clone.js';
import { schedule } from './due.js';
import type { Mixer } from './mixer.js';
import { packHeld } from './pack.js';
import { pageOut } from './paging.js';
import { scoreTouched } from './scored.js';
import { type Controls, none, type Subject, type Voice } from './voice.js';

/**
 * The last entry taken before `t`, or at it where `inclusive` says so, as it does for a change a
 * sync made. A host's change between frames is taken strictly: it shows from the next frame on, as
 * it did live.
 */
export function last<T extends { at: number }>(
  list: readonly T[],
  t: number,
  inclusive: boolean | ((e: T) => boolean),
): T | undefined {
  let lo = 0;
  let hi = list.length - 1;
  let found: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = list[mid] as T;
    if (e.at < t || (e.at === t && (typeof inclusive === 'function' ? inclusive(e) : inclusive))) {
      found = e;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Deep equality over plain data, for telling whether a host field changed. */
function same(a: unknown, b: unknown): boolean {
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
  voice.note(Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now, mix.moving);
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

/** A copy of a subject's record that shares nothing a read could change. */
export function copyHeld<I, O>(voice: Voice<I, O>, h: Subject<unknown>): Subject<unknown> {
  let kept: Map<object, unknown> | null = null;
  if (h.kept !== null) {
    kept = new Map();
    for (const [owner, value] of h.kept) kept.set(owner, clone(value));
  }
  const patch = voice.patch;
  return {
    ...h,
    bands: h.bands === null ? null : h.bands.slice(),
    state: h.state === undefined ? undefined : patch.clone ? patch.clone(h.state) : clone(h.state),
    kept,
    unkept: h.unkept?.map(clone),
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    base: h.base === undefined ? undefined : clone(h.base),
    slope: h.slope === undefined ? undefined : clone(h.slope),
    snaps: undefined,
    inputs: undefined,
    next: null,
    version: Number.NaN,
    loci: null,
    slot: -1,
  };
}

/** Under `history` with `inputs`, copies the host fields any voice reads, once a frame, when they changed. */
export function recordHost<I, O>(mix: Mixer<I, O>, now: number): void {
  const log = mix.hostLog;
  const prev = log[log.length - 1];
  if (prev !== undefined && prev.at === now) return;
  const host = mix.opts.host as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const v of mix.cued)
    for (const f of v.patch.reads ?? none) if (!(f in fields)) fields[f] = clone(host[f]);
  if (prev !== undefined && same(prev.fields, fields)) return;
  log.push({ at: now, fields });
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
  inputs.push({ at: mix.now, value });
  const reach = mix.now - history.ms;
  const out = older(inputs, reach);
  if (out.length > 0)
    pageOut(mix, 'input', voice.id, mix.keys?.key(subject), out, (e) => e.value, reach);
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
  if (prev !== undefined && mix.now - prev.at < (history.every ?? 200)) return;
  snaps.push({ at: mix.now, held: copyHeld(voice, held) });
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
  const left: { subject: I; at: number; held: Subject<unknown> }[] = [];
  for (const e of voice.left ?? [])
    if (e.at >= reach) left.push(e);
    else if (mix.keys !== null)
      pageOut(
        mix,
        'left',
        voice.id,
        mix.keys.key(e.subject),
        [e],
        (x) => packHeld(voice, x.held),
        reach,
      );
  left.push({ subject, at: Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now, held });
  voice.left = left;
}

/** The record a subject had at mix time `t` and left a voice with after it, if it left after `t`. */
export function leftAt<I>(
  left: readonly { subject: I; at: number; held: Subject<unknown> }[] | null,
  subject: I,
  t: number,
): Subject<unknown> | undefined {
  let found: { at: number; held: Subject<unknown> } | undefined;
  for (const e of left ?? [])
    if (e.at > t && Object.is(e.subject, subject) && (found === undefined || e.at < found.at))
      found = e;
  return found?.held;
}

/** The mix time a motion patch keeps a released subject from, and how far back, under history. */
export function releasing<I, O>(mix: Mixer<I, O>): [at?: number, reach?: number] {
  const history = mix.opts.history;
  if (history === undefined || Number.isNaN(mix.now)) return [];
  return [mix.now, mix.now - history.ms];
}
