import type { Store } from './store.js';

/** Past this many, `has` looks in a set rather than down the list. */
const FEW = 8;

/**
 * The subjects a voice's `subjects` names, once each in the order first named. Most voices name
 * one, which a `Set` per voice spends its smallest table on.
 */
export class Named<I> {
  readonly list: readonly I[];
  private readonly set: Set<I> | null;
  /** Each subject's `stagger` answer, asked at cue; null for a voice with no stagger. */
  readonly delays: Map<I, number> | null = null;
  /** The same answers in `list` order; null for a voice with no stagger. */
  readonly ordered: Float64Array | null = null;
  /** Whether every one of `ordered` is a finite number. */
  readonly finite: boolean = true;
  /** The longest of `delays`, 0 at least, and the least, 0 at most: a voice's bounds at cue. */
  readonly latest: number = 0;
  readonly soonest: number = 0;

  constructor(subjects: Iterable<I>, stagger?: (subject: I) => number) {
    // An array of distinct subjects, as nearly every voice names, is copied without iterating it.
    if (Array.isArray(subjects) && distinct(subjects)) {
      this.list = subjects.slice();
      this.set = null;
      if (stagger) [this.delays, this.ordered] = delaysOf(this.list, stagger);
      [this.latest, this.soonest, this.finite] = boundsOf(this.ordered);
      return;
    }
    const list: I[] = [];
    let set: Set<I> | null = null;
    for (const s of subjects) {
      if (set !== null) {
        if (!set.has(s)) {
          set.add(s);
          list.push(s);
        }
      } else if (!list.includes(s)) {
        list.push(s);
        if (list.length > FEW) set = new Set(list);
      }
    }
    // Exactly as long as it is: a list grown by push keeps room for 17.
    this.list = list.slice();
    this.set = set;
    if (stagger) [this.delays, this.ordered] = delaysOf(this.list, stagger);
    [this.latest, this.soonest, this.finite] = boundsOf(this.ordered);
  }

  get size(): number {
    return this.list.length;
  }

  has(subject: I): boolean {
    return this.set === null ? this.list.includes(subject) : this.set.has(subject);
  }
}

function delaysOf<I>(
  list: readonly I[],
  stagger: (subject: I) => number,
): [Map<I, number>, Float64Array] {
  const delays = new Map<I, number>();
  const ordered = new Float64Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const s = list[i] as I;
    const d = stagger(s);
    delays.set(s, d);
    ordered[i] = d ?? 0;
  }
  return [delays, ordered];
}

function boundsOf(delays: Float64Array | null): [number, number, boolean] {
  let latest = 0;
  let soonest = 0;
  let finite = true;
  for (const delay of delays ?? []) {
    if (delay > latest) latest = delay;
    if (delay < soonest) soonest = delay;
    if (!Number.isFinite(delay)) finite = false;
  }
  return [latest, soonest, finite];
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
