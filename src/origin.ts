import { backsWith, backWith, type Clock, elapsedWith, timeWith } from './clock.js';
import { childTimeFor, ownTimeFor } from './remap.js';
import type { Voice } from './voice.js';

/** A clock a voice ran on before its current one, until its local time `until`. */
export interface Past extends Clock {
  until: number;
  /** The voice's `rebuilds` while it ran on this clock. */
  rebuilds: number;
  /** Whether the voice left it by a seek. */
  sought: boolean;
  /** How many clocks the voice had left before it, those let go included; absent from a store written before it was kept. */
  n?: number;
}

/** The most past clocks a voice keeps. */
export const MOST = 256;

/**
 * Keeps the clock a voice is leaving at its local time `u`, ahead of a rate change, ramp or seek,
 * where a subject's origin could still be found on it.
 */
export function leave<I, O>(voice: Voice<I, O>, u: number, sought = false): void {
  const past = voice.clocks;
  // A voice with neither stagger nor children is only ever asked when its clock read 0, and where
  // one running back last reached it.
  const reach =
    voice.holding !== null || voice.spec.stagger !== undefined ? Number.POSITIVE_INFINITY : 0;
  if (
    past !== null &&
    !backsWith(voice) &&
    reached(past, 0) >= reach &&
    reached(past, fresh(voice)) >= reach
  )
    return;
  const { anchorNow, anchorElapsed, rate, ramp, rebuilds } = voice;
  const n = leftCount(past);
  const left: Past = { anchorNow, anchorElapsed, rate, ramp, until: u, rebuilds, sought, n };
  if (past === null) voice.clocks = [left];
  // Down to the latest half, so the copy comes once every MOST / 2 clocks, not on each.
  else if (past.length >= MOST) voice.clocks = [...past.slice(past.length - MOST / 2), left];
  else past.push(left);
}

/**
 * The mix time the latest clock a voice left since its last seek ran back to `elapsed` on, before
 * it was left; NaN where none did.
 */
export function pastRunBack<I, O>(voice: Voice<I, O>, elapsed: number): number {
  const past = voice.clocks;
  if (past === null) return Number.NaN;
  for (let i = past.length - 1; i >= 0; i--) {
    const p = past[i] as Past;
    if (p.sought) break;
    if (!backsWith(p)) continue;
    const t = backWith(p, elapsed);
    if (t >= p.anchorNow && t <= p.until) return t;
  }
  return Number.NaN;
}

/** How many clocks a voice has left, those let go included. */
export function leftCount(past: readonly Past[] | null): number {
  return past === null || past.length === 0
    ? 0
    : ((past[past.length - 1] as Past).n ?? past.length - 1) + 1;
}

/** A voice's past clocks as they stood when it had left `count`. */
export function pastAt(past: Past[], count: number): Past[] | null {
  const keep = past.length - (leftCount(past) - count);
  if (keep >= past.length) return past;
  return keep <= 0 ? null : past.slice(0, keep);
}

/** The most a voice's past clocks from index `from` read before they were left. */
function reached(past: readonly Past[], from: number): number {
  let most = Number.NEGATIVE_INFINITY;
  for (let i = from; i < past.length; i++) {
    const p = past[i] as Past;
    const e = elapsedWith(p, p.until);
    if (e > most) most = e;
  }
  return most;
}

/** Where a walk for a record rebuilt by the voice's last seek starts: its first clock since. */
function fresh<I, O>(voice: Voice<I, O>): number {
  const past = voice.clocks;
  if (past === null) return 0;
  let i = 0;
  while (i < past.length && (past[i] as Past).rebuilds !== voice.rebuilds) i++;
  return i;
}

/**
 * Where a walk for a stateful record at `elapsed` starts after a seek back before it: the clock that
 * seek entered, since a subject sent back before its start starts afresh.
 */
function backFrom<I, O>(voice: Voice<I, O>, past: readonly Past[], elapsed: number): number {
  for (let i = past.length - 1; i >= 0; i--) {
    const p = past[i] as Past;
    if (p.sought && (past[i + 1]?.anchorElapsed ?? voice.anchorElapsed) < elapsed) return i + 1;
  }
  return 0;
}

/**
 * The mix time a voice's clock first read `elapsed`, or will by its controls now, through its owners'
 * clocks. A clock entered already past it, by a seek, answers where that clock would have read it.
 * `rebuilt` starts from the last seek that rebuilt state, as a stateful record does.
 */
export function originOf<I, O>(voice: Voice<I, O>, elapsed: number, rebuilt: boolean): number {
  const past = voice.clocks;
  // A voice with no first pass shows every subject from its start, whatever its stagger.
  let t = voice.beginless ? voice.start : Number.NaN;
  if (past !== null && Number.isNaN(t)) {
    const from = rebuilt ? Math.max(fresh(voice), backFrom(voice, past, elapsed)) : 0;
    for (let i = from; i < past.length; i++) {
      const p = past[i] as Past;
      const at = timeWith(p, elapsed);
      if (at <= p.until) {
        t = at;
        break;
      }
    }
  }
  // Infinity where its clock will never read it: the subject waits for a clock that will.
  if (Number.isNaN(t)) t = timeWith(voice, elapsed);
  return voice.owner === null ? t : originOf(voice.owner, ownTimeFor(voice.owner, t), rebuilt);
}

/**
 * What an owner's clock reads at mix time `now`, through every owner above it: -Infinity before it
 * starts, where its children show nothing.
 */
export function ownerReading<I, O>(owner: Voice<I, O>, now: number): number {
  const t = owner.owner === null ? now : ownerReading(owner.owner, now);
  return t >= owner.start ? childTimeFor(owner, elapsedWith(owner, t)) : Number.NEGATIVE_INFINITY;
}

/** The mix time a voice started, or will by its owners' controls now: where its clock read 0. */
export function startedAt<I, O>(voice: Voice<I, O>): number {
  const owner = voice.owner;
  if (owner === null) return voice.start;
  const t = originOf(owner, ownTimeFor(owner, voice.start), false);
  // An owner standing still reads the child's start at every mix time since it stopped; the child
  // started no earlier than its cue, so its fade in counts from there.
  return t < voice.cuedAt && ownerReading(owner, voice.cuedAt) === voice.start ? voice.cuedAt : t;
}
