import { bind } from './bound.js';
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
  placesOf(this).set(subjects, xy, cell ?? Number.NaN);
  this.moved();
}

/** `Mix.place`: the subject's index, its own or a new one, which a `within` finder names it by. */
export function place<I, O>(this: Mixer<I, O>, subject: I): number {
  return placesOf(this).place(subject);
}

/**
 * The mix's indices, made at the first `place` or `plot`. An `around` voice cued before then read 0
 * everywhere, so it takes its circle with nothing to undo.
 */
function placesOf<I, O>(mix: Mixer<I, O>): Places<I> {
  if (mix.places !== null) return mix.places;
  const places = new Places<I>((s) => mix.chains.get(s)?.slot ?? -1, !production());
  mix.places = places;
  for (const voice of mix.cued) if (voice.bound === null) bind(mix, voice);
  return places;
}

/** `Mix.moved`: the host wrote new positions into the `xy` it gave `plot`. */
export function moved<I, O>(this: Mixer<I, O>): void {
  if (this.places !== null) this.places.dirty = true;
  this.lanes?.refill();
  this.stir();
}

/**
 * `Mix.put`: moves one subject, writing into the `xy` `plot` gave or the mix's own. The grid is built
 * again only once a sixteenth of the indices have left their cells.
 */
export function put<I, O>(this: Mixer<I, O>, subject: I, x: number, y: number): void {
  const places = this.places;
  const i = places === null ? undefined : places.at.get(subject);
  if (places === null || i === undefined)
    throw new Error('blits: put takes a subject with an index: place or plot it first');
  if (2 * i + 1 >= places.xy.length)
    throw new RangeError(
      `blits: put's subject is at index ${i}, past the positions plot was given: plot again with room for it`,
    );
  places.put(i, x, y);
  this.lanes?.refill();
  this.stir();
}
