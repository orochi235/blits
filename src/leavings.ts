import { Store } from './store.js';
import { type Cut, within } from './transport.js';
import type { Left, Subject } from './voice.js';

/**
 * Under history, the records subjects left a voice with, while a seek or a read back may reach
 * them: in the order they left, the oldest let go of from the front, and each subject's found
 * without looking through the others'.
 */
export class Leavings<I> {
  private list: Left<I>[] = [];
  /** How many at the front of `list` have been let go of, cleared out once they are half of it. */
  private head = 0;
  private readonly by = new Store<I, Left<I>[]>();

  static from<I>(entries: readonly Left<I>[]): Leavings<I> | null {
    if (entries.length === 0) return null;
    const out = new Leavings<I>();
    for (const e of entries) out.push(e);
    return out;
  }

  push(e: Left<I>): void {
    this.list.push(e);
    const own = this.by.get(e.subject);
    if (own === undefined) this.by.set(e.subject, [e]);
    else own.push(e);
  }

  /**
   * Lets go of every entry that left before `reach`, handing each to `out` first. They are at the
   * front: entries are in the order they left, and mix time does not run back along it.
   */
  expire(reach: number, out: ((e: Left<I>) => void) | null): void {
    const list = this.list;
    let head = this.head;
    while (head < list.length && !((list[head] as Left<I>).at >= reach)) {
      const e = list[head++] as Left<I>;
      if (out !== null) out(e);
      const own = this.by.get(e.subject) as Left<I>[];
      if (own.length === 1) this.by.delete(e.subject);
      else own.shift();
    }
    this.head = head;
    if (head >= 32 && head * 2 >= list.length) {
      this.list = list.slice(head);
      this.head = 0;
    }
  }

  /** The record `subject` had at `cut` and left with after it, if it left after `cut`. */
  at(subject: I, cut: Cut): Subject<unknown> | undefined {
    const own = this.by.get(subject);
    if (own === undefined) return undefined;
    for (const e of own) if (!within(cut, e.seq, e.sync)) return e.held;
    return undefined;
  }

  /** Each time `subject` left, oldest first. */
  of(subject: I): readonly Left<I>[] {
    return this.by.get(subject) ?? [];
  }

  /** Every entry, oldest first. */
  all(): readonly Left<I>[] {
    return this.head === 0 ? this.list : this.list.slice(this.head);
  }
}
