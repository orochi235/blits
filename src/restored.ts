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
  /** By subject, the `n` its record was last put back, written or deleted at; none reads as 0. */
  private readonly at = new Store<I, number>();
  /**
   * Each seek back sought to an earlier moment than every one after it, oldest first: the earliest
   * moment sought since seek `n` is that of the first here at or after it.
   */
  private readonly least: { n: number; t: number }[] = [];
  /** By seek, the records subjects left with after its moment, and where it cut; null until one has any. */
  private futures: Map<number, { left: Leavings<I>; cut: Cut }> | null = null;
  /** The latest seek's moment. */
  private t = Number.NaN;

  /**
   * `own` holds the records as they stood before the first seek. `make` puts a record back as it
   * stood at `t`, undefined where it had none then; `top` is the latest seek's moment.
   */
  constructor(
    private readonly own: Store<I, Subject<unknown>>,
    private readonly make: (
      live: Subject<unknown>,
      t: number,
      top: number,
    ) => Subject<unknown> | undefined,
  ) {
    super();
  }

  /** A seek back to `t`: `left` has the records subjects left with after `cut`, null for none. */
  back(t: number, cut: Cut, left: Leavings<I> | null): void {
    const n = ++this.n;
    const least = this.least;
    while (least.length > 0 && (least[least.length - 1] as { t: number }).t >= t) least.pop();
    least.push({ n, t });
    this.t = t;
    if (left !== null) {
      this.futures ??= new Map();
      this.futures.set(n, { left, cut });
    }
  }

  /** The earliest moment sought by seek `from` or any after it. */
  private since(from: number): number {
    const least = this.least;
    let lo = 0;
    let hi = least.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((least[mid] as { n: number }).n >= from) hi = mid;
      else lo = mid + 1;
    }
    return (least[lo] as { t: number }).t;
  }

  override get(key: I): Subject<unknown> | undefined {
    const at = this.at.get(key) ?? 0;
    if (at === this.n) return this.own.get(key);
    this.at.set(key, this.n);
    // A subject that left after the moment the next seek sought had the record it left with,
    // whatever it has now. Leaving is a write, so no later seek's leavings can hold it.
    const future = this.futures?.get(at + 1);
    const live = future?.left.at(key, future.cut) ?? this.own.get(key);
    if (live === undefined) return undefined;
    const made = this.make(live, this.since(at + 1), this.t);
    if (made === undefined) this.own.delete(key);
    else this.own.set(key, made);
    return made;
  }

  override set(key: I, value: Subject<unknown>): void {
    this.own.set(key, value);
    this.at.set(key, this.n);
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
