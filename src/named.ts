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
  /** The longest of `delays`, 0 at least, and the least, 0 at most: a voice's bounds at cue. */
  readonly latest: number = 0;
  readonly soonest: number = 0;

  constructor(subjects: Iterable<I>, stagger?: (subject: I) => number) {
    // An array of distinct subjects, as nearly every voice names, is copied without iterating it.
    if (Array.isArray(subjects) && distinct(subjects)) {
      this.list = subjects.slice();
      this.set = null;
      if (stagger) [this.delays, this.ordered] = delaysOf(this.list, stagger);
      [this.latest, this.soonest] = boundsOf(this.ordered);
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
    [this.latest, this.soonest] = boundsOf(this.ordered);
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

function boundsOf(delays: Float64Array | null): [number, number] {
  let latest = 0;
  let soonest = 0;
  for (const delay of delays ?? []) {
    if (delay > latest) latest = delay;
    if (delay < soonest) soonest = delay;
  }
  return [latest, soonest];
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

/** Files `voice` under each subject in `subjects`, in an index of the voices naming each. */
export function file<I, V>(index: Store<I, V[]>, subjects: readonly I[], voice: V): void {
  for (const subject of subjects) {
    const list = index.get(subject);
    if (list === undefined) index.set(subject, [voice]);
    else list.push(voice);
  }
}

/** Takes `voice` out from under each subject in `subjects`, as `file` put it there. */
export function unfile<I, V>(index: Store<I, V[]>, subjects: readonly I[], voice: V): void {
  for (const subject of subjects) {
    const list = index.get(subject);
    if (list === undefined) continue;
    const i = list.indexOf(voice);
    if (i < 0) continue;
    // Shifted by hand: `splice` makes an array of what it took, once a subject.
    for (let k = i + 1; k < list.length; k++) list[k - 1] = list[k] as V;
    list.pop();
    if (list.length === 0) index.delete(subject);
  }
}
