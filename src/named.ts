/** Past this many, `has` looks in a set rather than down the list. */
const FEW = 8;

/**
 * The subjects a voice's `subjects` names, once each in the order first named. Most voices name
 * one, which a `Set` per voice spends its smallest table on.
 */
export class Named<I> {
  readonly list: readonly I[];
  private readonly set: Set<I> | null;

  constructor(subjects: Iterable<I>) {
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
  }

  get size(): number {
    return this.list.length;
  }

  has(subject: I): boolean {
    return this.set === null ? this.list.includes(subject) : this.set.has(subject);
  }

  [Symbol.iterator](): Iterator<I> {
    return this.list[Symbol.iterator]();
  }
}
