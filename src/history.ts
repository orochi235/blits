import { elapsedWith } from './clock.js';
import { clone } from './clone.js';
import { schedule } from './due.js';
import type { Mixer } from './mixer.js';
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
  mix.stirred = true;
  schedule(mix, voice);
  const log = voice.log;
  if (log === null) return;
  voice.note(Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now, mix.moving);
  const reach = mix.now - (mix.opts.history as { ms: number }).ms;
  let drop = 0;
  while (drop + 1 < log.length && (log[drop + 1] as Controls).at <= reach) drop++;
  if (drop > 0) log.splice(0, drop);
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
  while (log.length > 1 && (log[1] as { at: number }).at <= reach) log.shift();
}

/** Under `history` with `inputs`, keeps what an input signal read, each time it changes. */
export function record<I, O>(mix: Mixer<I, O>, held: Subject<unknown>, value: number): void {
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
  while (inputs.length > 1 && (inputs[1] as { at: number }).at <= reach) inputs.shift();
}

/** Under `history`, keeps a copy of a stateful voice's record for this subject every so often. */
export function remember<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, held: Subject<unknown>): void {
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
  while (snaps.length > 1 && (snaps[1] as { at: number }).at <= reach) snaps.shift();
}
