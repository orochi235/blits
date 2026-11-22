import { confine } from './bound.js';
import type { Mixer } from './mixer.js';
import { Places } from './places.js';
import type { PlotOptions } from './types.js';
import { production, warnOnce } from './warn.js';

const NUMBERS = ['', 'one number', 'two numbers', 'three numbers'];

/** By mix, what the old `plot` shape warns about, once. */
const oldShape = new WeakMap<object, object>();

/**
 * `Mix.plot`: the mix's subjects and their positions, `axes` numbers a subject side by side in
 * `xy`, read in place. A number for `opts` is the old shape, `cell` alone, kept for one release.
 */
export function plot<I, O>(
  this: Mixer<I, O>,
  subjects: readonly I[],
  xy: Float64Array,
  opts?: PlotOptions | number,
): void {
  let o: PlotOptions | undefined = opts as PlotOptions | undefined;
  if (typeof opts === 'number') {
    let about = oldShape.get(this);
    if (about === undefined) {
      about = {};
      oldShape.set(this, about);
    }
    warnOnce(about, "plot's cell is an option now: plot(subjects, xy, { cell })");
    o = { cell: opts };
  }
  const axes = o?.axes ?? 2;
  if (axes !== 1 && axes !== 2 && axes !== 3)
    throw new RangeError(`blits: plot's axes is 1, 2 or 3, not ${axes}`);
  const cell = o?.cell;
  if (xy.length < axes * subjects.length)
    throw new RangeError(
      `blits: plot takes ${NUMBERS[axes]} a subject on ${axes} ${axes === 1 ? 'axis' : 'axes'}: ${subjects.length} subjects need ${axes * subjects.length}, not ${xy.length}`,
    );
  if (cell !== undefined && !(cell > 0 && cell < Number.POSITIVE_INFINITY))
    throw new RangeError(`blits: plot's cell is a size above 0, not ${cell}`);
  placesOf(this).set(subjects, xy, cell ?? Number.NaN, axes);
  this.moved();
}

/** `Mix.place`: the subject's index, its own or a new one, which a `within` finder names it by. */
export function place<I, O>(this: Mixer<I, O>, subject: I): number {
  return placesOf(this).place(subject);
}

/**
 * The mix's indices, made at the first `place` or `plot`. An `around` voice cued before then read 0
 * everywhere, so it takes its ball with nothing to undo.
 */
function placesOf<I, O>(mix: Mixer<I, O>): Places<I> {
  if (mix.places !== null) return mix.places;
  const places = new Places<I>((s) => mix.chains.get(s)?.slot ?? -1, !production());
  mix.places = places;
  for (const voice of mix.cued) if (voice.bound === null) confine(mix, voice);
  return places;
}

/** `Mix.moved`: the host wrote new positions into the `xy` it gave `plot`. */
export function moved<I, O>(this: Mixer<I, O>): void {
  if (this.places !== null) this.places.dirty = true;
  this.lanes?.refill();
  this.stir();
}

/**
 * `Mix.put`: moves one subject, writing into the `xy` `plot` gave or the mix's own, as many numbers
 * as it has axes, an axis left out as 0. The grid is built again only once a sixteenth of the
 * indices have left their cells.
 */
export function put<I, O>(this: Mixer<I, O>, subject: I, x: number, y = 0, z = 0): void {
  const places = this.places;
  const i = places === null ? undefined : places.at.get(subject);
  if (places === null || i === undefined)
    throw new Error('blits: put takes a subject with an index: place or plot it first');
  if (!places.has(i))
    throw new RangeError(
      `blits: put's subject is at index ${i}, past the positions plot was given: plot again with room for it`,
    );
  places.put(i, x, y, z);
  this.lanes?.refill();
  this.stir();
}
