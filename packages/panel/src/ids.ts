/** Numbers subjects as they cross the seam, holding the objects weakly. */
export class Ids {
  private weak = new WeakMap<object, number>();
  private strong = new Map<unknown, number>();
  private back = new Map<number, WeakRef<object> | { value: unknown }>();
  private next = 1;

  of(subject: unknown): number {
    const object = typeof subject === 'object' && subject !== null;
    let id = object ? this.weak.get(subject) : this.strong.get(subject);
    if (id !== undefined) return id;
    id = this.next++;
    if (object) {
      this.weak.set(subject, id);
      this.back.set(id, new WeakRef(subject));
    } else {
      this.strong.set(subject, id);
      this.back.set(id, { value: subject });
    }
    return id;
  }

  /** Forgets the ids of subjects that have been collected. */
  prune(): void {
    for (const [id, b] of this.back)
      if (b instanceof WeakRef && b.deref() === undefined) this.back.delete(id);
  }

  get(id: number): unknown {
    const b = this.back.get(id);
    if (b === undefined) return undefined;
    return b instanceof WeakRef ? b.deref() : b.value;
  }
}
