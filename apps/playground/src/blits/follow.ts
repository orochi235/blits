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
