/**
 * By subject number, the crowd voices whose rows are placed on it, so letting a number go reaches
 * its rows without walking every crowd's. Kept by voice id, which a row keeps as a crowd closes up
 * or is rebuilt around it.
 */
export class Placed {
  /** By subject number, one voice placed on it; 0, which is no voice's id, for none. */
  private one = new Int32Array(0);
  /** The others, for a subject with several; null until some subject has two. */
  private rest: Map<number, number[]> | null = null;

  /** Makes room for subject numbers below `cap`. */
  grow(cap: number): void {
    const one = new Int32Array(cap);
    one.set(this.one);
    this.one = one;
  }

  /** Some voice placed on the subject at `slot`, 0 for none. */
  any(slot: number): number {
    return (this.one[slot] as number) | 0;
  }

  /** Every voice placed on the subject at `slot`, in no order: for a test to read. */
  all(slot: number): number[] {
    const one = this.any(slot);
    return one === 0 ? [] : [one, ...(this.rest?.get(slot) ?? [])];
  }

  add(slot: number, id: number): void {
    if (this.one[slot] === 0) {
      this.one[slot] = id;
      return;
    }
    this.rest ??= new Map();
    const more = this.rest.get(slot);
    if (more === undefined) this.rest.set(slot, [id]);
    else more.push(id);
  }

  remove(slot: number, id: number): void {
    const more = this.rest?.get(slot);
    if (this.one[slot] === id) this.one[slot] = more === undefined ? 0 : (more.pop() as number);
    else if (more !== undefined) {
      const i = more.indexOf(id);
      if (i < 0) return;
      more[i] = more[more.length - 1] as number;
      more.pop();
    } else return;
    if (more !== undefined && more.length === 0) (this.rest as Map<number, number[]>).delete(slot);
  }
}
