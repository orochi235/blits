import type { Store } from './store.js';

/** Past this many, a subject is looked up in a map of places rather than down the list. */
const FEW = 8;

/**
 * The subjects a voice's `subjects` names, once each in the order first named. Most voices name
 * one, which a `Map` per voice spends its smallest table on.
 */
export class Named<I> {
  readonly list: readonly I[];
  /** Each subject's place in `list`; null for a list of `FEW` or fewer, searched instead. */
  private readonly places: Map<I, number> | null;
  /** Each subject's `stagger` answer, asked at cue, in `list` order; null for a voice with no stagger. */
  readonly ordered: Float64Array | null = null;
  /** Whether every one of `ordered` is a finite number. */
  readonly finite: boolean = true;
  /** The longest of `ordered`, 0 at least, and the least, 0 at most: a voice's bounds at cue. */
  readonly latest: number = 0;
  readonly soonest: number = 0;

  constructor(subjects: Iterable<I>, stagger?: (subject: I) => number) {
    // An array of distinct subjects, as nearly every voice names, is copied, a long one placed as it is.
    const short = Array.isArray(subjects) && distinct(subjects);
    const placed = short || !Array.isArray(subjects) ? null : placesOf(subjects);
    if (short || placed !== null) {
      this.list = (subjects as I[]).slice();
      this.places = placed;
    } else {
      const list: I[] = [];
      let places: Map<I, number> | null = null;
      for (const s of subjects) {
        if (places !== null) {
          if (places.get(s) === undefined) {
            places.set(s, list.length);
            list.push(s);
          }
        } else if (!list.includes(s)) {
          list.push(s);
          if (list.length > FEW) places = new Map(list.map((x, i) => [x, i]));
        }
      }
      // Exactly as long as it is: a list grown by push keeps room for 17.
      this.list = list.slice();
      this.places = places;
    }
    if (stagger) {
      const ordered = new Float64Array(this.list.length);
      let latest = 0;
      let soonest = 0;
      let finite = true;
      for (let i = 0; i < ordered.length; i++) {
        const d = stagger(this.list[i] as I) ?? 0;
        ordered[i] = d;
        if (d > latest) latest = d;
        if (d < soonest) soonest = d;
        if (!Number.isFinite(d)) finite = false;
      }
      this.ordered = ordered;
      this.latest = latest;
      this.soonest = soonest;
      this.finite = finite;
    }
  }

  get size(): number {
    return this.list.length;
  }

  has(subject: I): boolean {
    return this.places === null ? this.list.includes(subject) : this.places.has(subject);
  }

  /** `subject`'s `stagger` answer as asked at cue; undefined where it has none or is not named. */
  delayOf(subject: I): number | undefined {
    const o = this.ordered;
    if (o === null) return undefined;
    const i = this.placeOf(subject);
    return i === undefined ? undefined : o[i];
  }

  private placeOf(subject: I): number | undefined {
    if (this.places !== null) return this.places.get(subject);
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      // As `includes` compares, so NaN finds NaN.
      if (s === subject || (Number.isNaN(s as number) && Number.isNaN(subject as number))) return i;
    }
    return undefined;
  }
}

/** Each subject's place in `subjects`; null where one is named twice, as the map then holds fewer. */
function placesOf<I>(subjects: readonly I[]): Map<I, number> | null {
  const places = new Map<I, number>();
  for (let i = 0; i < subjects.length; i++) places.set(subjects[i] as I, i);
  return places.size === subjects.length ? places : null;
}

/** Whether a short array names no subject twice, as `includes` compares; a long one says no. */
function distinct<I>(subjects: readonly I[]): boolean {
  const n = subjects.length;
  if (n > FEW) return false;
  for (let i = 1; i < n; i++) {
    const a = subjects[i];
    for (let j = 0; j < i; j++) {
      const b = subjects[j];
      if (a === b || (Number.isNaN(a as number) && Number.isNaN(b as number))) return false;
    }
  }
  return true;
}

/** The list of a subject no voice is filed under any longer, kept in place of its entry. */
export const EMPTIED: never[] = Object.freeze([]) as unknown as never[];

/**
 * Lets go of `subject`'s emptied list. An object keeps its entry, pointed at `EMPTIED`: deleting a
 * million shrinks the WeakMap's table, up to 14 ms a frame, and the next voice naming them grows it back.
 */
export function emptied<I, V>(index: Store<I, V[]>, subject: I): void {
  if (typeof subject === 'object' && subject !== null) index.set(subject, EMPTIED);
  else index.delete(subject);
}
