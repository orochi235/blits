/**
 * By subject number, the crowd voices whose rows are placed on it, so letting a number go reaches
 * its rows without walking every crowd's. Kept by voice, whose seat a row keeps as a crowd closes
 * up or is rebuilt around it: a stop reads the seat off the voice it already touched, where a map
 * of seats by id cost a cold lookup in a table as large as the crowd.
 */
export class Placed<V extends { readonly id: number }> {
  /** By subject number, one voice placed on it, undefined for none. */
  private one: (V | undefined)[] = [];
  /** The others, for a subject with several; null until some subject has two. */
  private rest: Map<number, V[]> | null = null;

  /** Makes room for subject numbers below `cap`. */
  grow(cap: number): void {
    const one = this.one;
    for (let i = one.length; i < cap; i++) one.push(undefined);
  }

  /** Some voice placed on the subject at `slot`, undefined for none. */
  any(slot: number): V | undefined {
    return this.one[slot];
  }

  /** The ids of every voice placed on the subject at `slot`, in no order: for a test to read. */
  all(slot: number): number[] {
    const one = this.any(slot);
    return one === undefined ? [] : [one.id, ...(this.rest?.get(slot) ?? []).map((v) => v.id)];
  }

  /** Every voice placed on the subject at `slot`, in no order. */
  voices(slot: number): V[] {
    const one = this.any(slot);
    return one === undefined ? [] : [one, ...(this.rest?.get(slot) ?? [])];
  }

  add(slot: number, voice: V): void {
    if (this.one[slot] === undefined) {
      this.one[slot] = voice;
      return;
    }
    this.rest ??= new Map();
    const more = this.rest.get(slot);
    if (more === undefined) this.rest.set(slot, [voice]);
    else more.push(voice);
  }

  remove(slot: number, voice: V): void {
    const more = this.rest?.get(slot);
    if (this.one[slot] === voice) this.one[slot] = more === undefined ? undefined : more.pop();
    else if (more !== undefined) {
      const i = more.indexOf(voice);
      if (i < 0) return;
      more[i] = more[more.length - 1] as V;
      more.pop();
    } else return;
    if (more !== undefined && more.length === 0) (this.rest as Map<number, V[]>).delete(slot);
  }
}
