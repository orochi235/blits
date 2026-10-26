import type { Mixer } from './mixer.js';
import { Places } from './places.js';
import { production } from './warn.js';

/** `Mix.plot`: the mix's subjects and their positions, `x` then `y` side by side in `xy`, read in place. */
export function plot<I, O>(
  this: Mixer<I, O>,
  subjects: readonly I[],
  xy: Float64Array,
  cell?: number,
): void {
  if (xy.length < 2 * subjects.length)
    throw new RangeError(
      `blits: plot takes two numbers a subject, x then y: ${subjects.length} subjects need ${2 * subjects.length}, not ${xy.length}`,
    );
  if (cell !== undefined && !(cell > 0 && cell < Number.POSITIVE_INFINITY))
    throw new RangeError(`blits: plot's cell is a size above 0, not ${cell}`);
  this.places ??= new Places<I>();
  this.places.set(
    subjects,
    xy,
    cell ?? Number.NaN,
    (s) => this.chains.get(s)?.slot ?? -1,
    !production(),
  );
  this.moved();
}

/** `Mix.moved`: the host wrote new positions into the `xy` it gave `plot`. */
export function moved<I, O>(this: Mixer<I, O>): void {
  if (this.places !== null) this.places.dirty = true;
  this.lanes?.refill();
  this.stir();
}

/**
 * `Mix.put`: moves one plotted subject, writing into the `xy` it gave `plot`. The grid is built
 * again only once a sixteenth of the places have left their cells.
 */
export function put<I, O>(this: Mixer<I, O>, subject: I, x: number, y: number): void {
  const i = this.places?.at.get(subject);
  if (i === undefined) throw new Error('blits: put takes a subject plot gave: plot it first');
  (this.places as Places<I>).put(i, x, y);
  this.lanes?.refill();
  this.stir();
}
