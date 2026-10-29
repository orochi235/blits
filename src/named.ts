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
  /** The longest of `delays`, 0 at least, and the least, 0 at most: a voice's bounds at cue. */
  readonly latest: number = 0;
  readonly soonest: number = 0;

  constructor(subjects: Iterable<I>, stagger?: (subject: I) => number) {
    // An array of distinct subjects, as nearly every voice names, is copied without iterating it.
    if (Array.isArray(subjects) && distinct(subjects)) {
      this.list = subjects.slice();
      this.set = null;
      if (stagger) this.delays = delaysOf(this.list, stagger);
      [this.latest, this.soonest] = boundsOf(this.delays);
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
    if (stagger) this.delays = delaysOf(this.list, stagger);
    [this.latest, this.soonest] = boundsOf(this.delays);
  }

  get size(): number {
    return this.list.length;
  }

  has(subject: I): boolean {
    return this.set === null ? this.list.includes(subject) : this.set.has(subject);
  }
}

function delaysOf<I>(list: readonly I[], stagger: (subject: I) => number): Map<I, number> {
  const delays = new Map<I, number>();
  for (const s of list) delays.set(s, stagger(s));
  return delays;
}

function boundsOf(delays: Map<unknown, number> | null): [number, number] {
  let latest = 0;
  let soonest = 0;
  for (const delay of delays?.values() ?? []) {
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
