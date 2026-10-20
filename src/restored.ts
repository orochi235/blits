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
/** A moment sought, the end of frame `seq`. */
export interface Moment {
  readonly t: number;
  readonly seq: number;
}

export interface Stamp extends Moment {
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
  /** The store that made it; null on `gone`. */
  readonly of: object | null;
}

/** How a `Restored` puts a voice's records back; one class in the engine, so its calls inline. */
export interface PutBack<I> {
  /**
   * The record a subject that has not left since and is not reached has at `at`, given what the
   * store holds for it, as a seek there takes it.
   */
  now(key: I, held: Subject<unknown> | undefined, at: Moment): Subject<unknown> | undefined;
  /**
   * `live` put back as it stood at `at`, undefined where it had none then; `mine` says `live` is
   * the record the store held, which nothing else does.
   */
  make(live: Subject<unknown>, at: Moment, mine: boolean): Subject<unknown> | undefined;
}

const stamp = (of: object | null): Stamp => ({
  t: Number.NaN,
  seq: 0,
  up: null,
  rank: 0,
  left: null,
  cut: null,
  of,
});

/** What a reaching record a store has let go of is stamped with, so setting it again is seen. */
const gone = stamp(null);

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
  private stamp = stamp(this);
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
  /**
   * Stamps made a batch ahead of their seeks: one made at its seek is young when every old record
   * is written with it, and V8 notes each such write for its next scavenge.
   */
  private ready: Stamp[] = [];
  private aging: Stamp[] = [];
  /** The latest seek's moment. */
  top = Number.NaN;

  /** `own` holds the records as they stood before the first seek; `by` puts them back. */
  constructor(
    private readonly own: Store<I, Subject<unknown>>,
    private readonly by: PutBack<I>,
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
    this.stamp = this.fresh();
    this.top = t;
  }

  /** The next seek's stamp, from a batch made a batch of seeks ago, twice as many each time to 64. */
  private fresh(): Stamp {
    if (this.ready.length === 0) {
      const n = Math.min(64, Math.max(1, this.aging.length * 2));
      this.ready = this.aging.reverse();
      this.aging = [];
      for (let i = 0; i < n; i++) this.aging.push(stamp(this));
    }
    return this.ready.pop() ?? stamp(this);
  }

  /**
   * Whether a reaching record stamped by this store is still its record for the key it was found
   * under: every record let go is stamped `gone`, copies are stamped with nothing, and this turns
   * false if a stamped record is set again, which could put it under a second key.
   */
  private sure = true;

  override get(key: I): Subject<unknown> | undefined {
    return this.from(key, this.own.get(key));
  }

  /** A chain's record for a subject, found again without a lookup where this store stamped it. */
  override find(key: I, guess: Subject<unknown>): Subject<unknown> | undefined {
    const s = guess.restored;
    return s !== null && s.of === this && this.sure ? this.from(key, guess) : this.get(key);
  }

  /** `get`, given what `own` holds for `key`. */
  private from(key: I, own: Subject<unknown> | undefined): Subject<unknown> | undefined {
    const mark = own !== undefined && own.reaches;
    const at = (mark ? own.restored : this.at.get(key)) ?? this.first;
    const now = this.stamp;
    if (at === now) return own;
    if (mark) own.restored = now;
    else this.at.set(key, now);
    // A subject that left after the moment the next seek sought had the record it left with,
    // whatever it has now. Leaving is a write, so no later seek's leavings can hold it.
    const root = rootOf(at);
    const left = at.left?.at(key, at.cut as Cut);
    const live = left ?? this.by.now(key, own, root);
    const made = live && this.by.make(live, root, left === undefined);
    // Looked up again, not taken from `own`: a call made while it was put back may have set it.
    if (made === undefined) {
      this.shed(key);
      if (mark) this.at.set(key, now);
    } else if (made !== own) this.set(key, made);
    else if (!made.reaches) this.at.set(key, now);
    return made;
  }

  override set(key: I, value: Subject<unknown>): void {
    const old = this.own.get(key);
    if (old === value) {
      if (value.reaches) value.restored = this.stamp;
      else this.at.set(key, this.stamp);
      return;
    }
    if (old?.reaches) old.restored = gone;
    // Stamped already, it may be in a chain under another key.
    if (value.reaches && value.restored !== null) this.sure = false;
    this.own.set(key, value);
    if (value.reaches) value.restored = this.stamp;
    else this.at.set(key, this.stamp);
  }

  override delete(key: I): void {
    this.shed(key);
    this.at.set(key, this.stamp);
  }

  /** Lets go of the record held for `key`, stamping it `gone`. */
  private shed(key: I): void {
    const old = this.own.get(key);
    if (old?.reaches) old.restored = gone;
    this.own.delete(key);
  }

  override clear(): void {
    this.sure = false;
    this.own.clear();
    this.at.clear();
  }
}
