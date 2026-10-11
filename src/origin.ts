import { type Clock, elapsedWith, timeWith } from './clock.js';
import type { Voice } from './voice.js';

/** A clock a voice ran on before its current one, until its local time `until`. */
export interface Past extends Clock {
  until: number;
  /** The voice's `rebuilds` while it ran on this clock. */
  rebuilds: number;
}

/** The most past clocks a voice keeps. */
const MOST = 256;

/**
 * Keeps the clock a voice is leaving at its local time `u`, ahead of a rate change, ramp or seek,
 * where a subject's origin could still be found on it.
 */
export function leave<I, O>(voice: Voice<I, O>, u: number): void {
  const past = voice.clocks;
  if (past !== null && past.length >= MOST) return;
  // A voice with neither stagger nor children is only ever asked when its clock read 0.
  const reach =
    voice.holding !== null || voice.spec.stagger !== undefined ? Number.POSITIVE_INFINITY : 0;
  if (past !== null && reached(past, 0) >= reach && reached(past, fresh(voice)) >= reach) return;
  const { anchorNow, anchorElapsed, rate, ramp, rebuilds } = voice;
  const left: Past = { anchorNow, anchorElapsed, rate, ramp, until: u, rebuilds };
  if (past === null) voice.clocks = [left];
  else past.push(left);
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
 * The mix time a voice's clock first read `elapsed`, or will by its controls now, through its owners'
 * clocks. A clock entered already past it, by a seek, answers where that clock would have read it.
 * `rebuilt` starts from the last seek that rebuilt state, as a stateful record does.
 */
export function originOf<I, O>(voice: Voice<I, O>, elapsed: number, rebuilt: boolean): number {
  const past = voice.clocks;
  // A voice with no first pass shows every subject from its start, whatever its stagger.
  let t = voice.beginless ? voice.start : Number.NaN;
  if (past !== null && Number.isNaN(t)) {
    for (let i = rebuilt ? fresh(voice) : 0; i < past.length; i++) {
      const p = past[i] as Past;
      const at = timeWith(p, elapsed);
      if (at <= p.until) {
        t = at;
        break;
      }
    }
  }
  if (Number.isNaN(t)) {
    t = timeWith(voice, elapsed);
    if (t === Number.POSITIVE_INFINITY) t = voice.start + elapsed;
  }
  return voice.owner === null ? t : originOf(voice.owner, t, rebuilt);
}
