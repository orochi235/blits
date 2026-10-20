import type { Leavings } from './leavings.js';
import { Store } from './store.js';
import type { Cut } from './transport.js';
import type { Subject } from './voice.js';

/**
 * The seeks back after the one a record was last put back, written or deleted at, which every
 * record stamped then shares. The next seek fills it; a later seek to as early a moment joins it
 * to its own, so the root it reaches holds the earliest moment sought since. Only records and the
 * stamps joined beneath it hold it, so it is collected with the last record that can read it.
 */
export interface Stamp {
  /** On a root: the earliest moment sought since, and the frame that ended. */
  t: number;
  seq: number;
  /** The stamp this one was joined to, null on a root. */
  up: Stamp | null;
  /** A bound on how deep the stamps joined beneath it go, so joining the lower keeps paths short. */
  rank: number;
  /** The records subjects left with after this seek's moment, and where it cut; null for none. */
  left: Leavings<unknown> | null;
  cut: Cut | null;
}

const stamp = (): Stamp => ({ t: Number.NaN, seq: 0, up: null, rank: 0, left: null, cut: null });

/** The root `s` was joined to, halving the path there for the next read. */
function rootOf(s: Stamp): Stamp {
  let x = s;
  let up = x.up;
  while (up !== null) {
    const next = up.up;
    if (next === null) return up;
    x.up = next;
    x = next;
    up = x.up;
  }
  return x;
}

/**
 * A voice's records once a seek has gone back: each subject's is put back from the record it had,
 * the first time it is asked for after a seek, since the subjects a store holds cannot be listed.
 * It is one store however many seeks there are: by subject it keeps the stamp of the seek its
 * record was last put back at, and a record behind is put back to the earliest moment sought
 * since, as a seek back cuts what came after it and a later seek ahead of that moment must not
 * read past it.
 */
export class Restored<I> extends Store<I, Subject<unknown>> {
  /** What a record put back now is stamped with, filled by the next seek. */
  private stamp = stamp();
  /** What a record never stamped reads as: the first seek's. */
  private readonly first = this.stamp;
  /**
   * By subject, the stamp its record was last put back, written or deleted at; none reads as
   * `first`. A record that reaches its subject is its own, and holds it as `restored` instead,
   * sparing a write here per subject a seek puts back; one that does not may stand for many.
   */
  private readonly at = new Store<I, Stamp>();
  /**
   * The roots, each moment earlier than the next, held weakly: one no record can reach is never
   * read again, and those are cleared out once the list doubles.
   */
  private roots: WeakRef<Stamp>[] = [];
  private kept = 0;
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
    const s = this.stamp;
    if (left !== null) {
      s.left = left as Leavings<unknown>;
      s.cut = cut;
    }
    // Every root at or after `t` now reads `t`, so they and `s` are joined under one.
    const roots = this.roots;
    let root = s;
    let ref: WeakRef<Stamp> | null = null;
    while (roots.length > 0) {
      const r = (roots[roots.length - 1] as WeakRef<Stamp>).deref();
      if (r !== undefined && r.t < t) break;
      const w = roots.pop() as WeakRef<Stamp>;
      if (r === undefined) continue;
      if (r.rank > root.rank) {
        root.up = r;
        root = r;
        ref = w;
      } else {
        r.up = root;
        if (r.rank === root.rank) root.rank++;
      }
    }
    root.t = t;
    root.seq = cut.seq;
    roots.push(ref ?? new WeakRef(root));
    if (roots.length > 2 * this.kept + 16) {
      this.roots = roots.filter((w) => w.deref() !== undefined);
      this.kept = this.roots.length;
    }
    this.stamp = stamp();
    this.t = t;
  }

  override get(key: I): Subject<unknown> | undefined {
    const own = this.own.get(key);
    const mark = own !== undefined && own.reaches;
    const at = (mark ? own.restored : this.at.get(key)) ?? this.first;
    const now = this.stamp;
    if (at === now) return own;
    if (mark) own.restored = now;
    else this.at.set(key, now);
    // A subject that left after the moment the next seek sought had the record it left with,
    // whatever it has now. Leaving is a write, so no later seek's leavings can hold it.
    const { t, seq } = rootOf(at);
    const left = at.left?.at(key, at.cut as Cut);
    const live = left ?? this.now(key, own, t, seq);
    const made = live && this.make(live, t, this.t, left === undefined);
    if (made === undefined) {
      this.own.delete(key);
      if (mark) this.at.set(key, now);
    } else if (made !== own) this.set(key, made);
    else if (!made.reaches) this.at.set(key, now);
    return made;
  }

  override set(key: I, value: Subject<unknown>): void {
    this.own.set(key, value);
    if (value.reaches) value.restored = this.stamp;
    else this.at.set(key, this.stamp);
  }

  override delete(key: I): void {
    this.own.delete(key);
    this.at.set(key, this.stamp);
  }

  override clear(): void {
    this.own.clear();
    this.at.clear();
  }
}
