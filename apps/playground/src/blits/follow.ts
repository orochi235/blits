import type { Mix } from '@msb235/blits';

const EPS = 1e-6;

/**
 * Whether something other than the player's own sync moved a mix's clock this frame: a debugger's
 * hold, its seek or its step. `last` is where the player's previous sync left the clock, `before`
 * where it stood just before this one, `expect` what `mix.time` said this sync would reach, and
 * `now` where it did.
 */
export function movedElsewhere(
  last: number | null,
  before: number,
  expect: number,
  now: number,
): boolean {
  if (last === null) return false;
  return Math.abs(before - last) > EPS || Math.abs(now - expect) > EPS;
}

/**
 * Brings mix `m` to mix time `now`: seeking back, or syncing at the host time that reads it ahead.
 * False, with a warning naming it `name`, where its history cannot reach back to `now`, which leaves it ahead.
 */
export function alignTo<I, O>(m: Mix<I, O>, now: number, name: string): boolean {
  if (now < m.now - EPS) {
    let ok = true;
    try {
      m.seek(now);
    } catch (err) {
      ok = false;
      console.warn(`${name} cannot seek back to ${now} ms, so it stays ahead:`, err);
    }
    m.sync(m.timestamp);
    return ok;
  }
  const ts = m.when(now);
  m.sync(Number.isFinite(ts) && ts > m.timestamp ? ts : m.timestamp);
  return true;
}
