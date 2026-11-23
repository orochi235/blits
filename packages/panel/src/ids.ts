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

  /**
   * Forgets the ids of subjects that have been collected, and of the numbers, strings and other
   * plain subjects `kept` turns down, which nothing collects.
   */
  prune(kept: (subject: unknown) => boolean): void {
    for (const [id, b] of this.back)
      if (b instanceof WeakRef) {
        if (b.deref() === undefined) this.back.delete(id);
      } else if (!kept(b.value)) {
        this.back.delete(id);
        this.strong.delete(b.value);
      }
  }

  get(id: number): unknown {
    const b = this.back.get(id);
    if (b === undefined) return undefined;
    return b instanceof WeakRef ? b.deref() : b.value;
  }
}
