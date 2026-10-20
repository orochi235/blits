import type { Leavings } from './leavings.js';
import { Store } from './store.js';
import type { Cut } from './transport.js';
import type { Subject } from './voice.js';

/**
 * A voice's records once a seek has gone back: each subject's is put back from the record it had,
 * the first time it is asked for after a seek, since the subjects a store holds cannot be listed.
 * It is one store however many seeks there are: by subject it keeps how many seeks its record has
 * been put back for, and a record behind is put back to the earliest moment sought since, as a
 * seek back cuts what came after it and a later seek ahead of that moment must not read past it.
 */
export class Restored<I> extends Store<I, Subject<unknown>> {
  /** Seeks back so far. */
  private n = 0;
  /**
   * By subject, the `n` its record was last put back, written or deleted at; none reads as 0. A
   * record that reaches its subject is its own, and holds it as `restored` instead, sparing a write
   * here per subject a seek puts back; one that does not may stand for many.
   */
  private readonly at = new Store<I, number>();
  /**
   * Each seek back sought to an earlier moment than every one after it, oldest first: the earliest
   * moment sought since seek `n` is that of the first here at or after it.
   */
  private readonly least: { n: number; t: number; seq: number }[] = [];
  /** By seek, the records subjects left with after its moment, and where it cut; null until one has any. */
  private futures: Map<number, { left: Leavings<I>; cut: Cut }> | null = null;
  /** The latest seek's moment. */
  private t = Number.NaN;

  /**
   * `own` holds the records as they stood before the first seek, and `now` gives the one a subject
   * that has not left since has there, as a seek to `t`, the end of frame `seq`, takes it. `make`
   * puts a record back as it stood at `t`, undefined where it had none then; `top` is the latest
   * seek's moment, and `mine` says `live` is the record this store held, which nothing else does.
   */
  constructor(
    private readonly own: Store<I, Subject<unknown>>,
    private readonly now: (
      key: I,
      held: Subject<unknown> | undefined,
      t: number,
      seq: number,
    ) => Subject<unknown> | undefined,
    private readonly make: (
      live: Subject<unknown>,
      t: number,
      top: number,
      mine: boolean,
    ) => Subject<unknown> | undefined,
  ) {
    super();
  }

  /** A seek back to `t`: `left` has the records subjects left with after `cut`, null for none. */
  back(t: number, cut: Cut, left: Leavings<I> | null): void {
    const n = ++this.n;
    const least = this.least;
    while (least.length > 0 && (least[least.length - 1] as { t: number }).t >= t) least.pop();
    least.push({ n, t, seq: cut.seq });
    this.t = t;
    if (left !== null) {
      this.futures ??= new Map();
      this.futures.set(n, { left, cut });
    }
  }

  /** The earliest moment sought by seek `from` or any after it, and the frame it ended. */
  private since(from: number): { t: number; seq: number } {
    const least = this.least;
    let lo = 0;
    let hi = least.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((least[mid] as { n: number }).n >= from) hi = mid;
      else lo = mid + 1;
    }
    return least[lo] as { t: number; seq: number };
  }

  override get(key: I): Subject<unknown> | undefined {
    const own = this.own.get(key);
    const mark = own !== undefined && own.reaches;
    const at = mark ? own.restored : (this.at.get(key) ?? 0);
    const n = this.n;
    if (at === n) return own;
    if (mark) own.restored = n;
    else this.at.set(key, n);
    // A subject that left after the moment the next seek sought had the record it left with,
    // whatever it has now. Leaving is a write, so no later seek's leavings can hold it.
    const future = this.futures?.get(at + 1);
    const { t, seq } = this.since(at + 1);
    const left = future?.left.at(key, future.cut);
    const live = left ?? this.now(key, own, t, seq);
    const made = live && this.make(live, t, this.t, left === undefined);
    if (made === undefined) {
      this.own.delete(key);
      if (mark) this.at.set(key, n);
    } else if (made !== own) this.set(key, made);
    else if (!made.reaches) this.at.set(key, n);
    return made;
  }

  override set(key: I, value: Subject<unknown>): void {
    this.own.set(key, value);
    if (value.reaches) value.restored = this.n;
    else this.at.set(key, this.n);
  }

  override delete(key: I): void {
    this.own.delete(key);
    this.at.set(key, this.n);
  }

  override clear(): void {
    this.own.clear();
    this.at.clear();
  }
}
