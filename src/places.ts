import { type Cut, within } from './cut.js';
import { Grid } from './grid.js';
import { Store } from './store.js';

/** An index held for a subject dropped under history, and the frame and mix time of the drop. */
interface Parked<I> {
  subject: I;
  i: number;
  seq: number;
  t: number;
  /** Made before its frame was read. */
  early: boolean;
}

/**
 * The index the host gives each subject, by `place` or by its place in the list `plot` was given,
 * and where the host says each one is, over `Grid`. Subjects are held as the rest of the mix holds
 * them: an object weakly, anything else until `drop`. An index a subject leaves, by `drop` or by
 * being collected, is handed out again.
 */
export class Places<I> extends Grid {
  /** By subject, its index. */
  at = new Store<I, number>();
  /** By index, its subject's lane number, -1 for one with none or a subject let go. */
  slots = new Int32Array(0);
  /** By lane number, the index it was put in `slots` at, -1 for none. */
  placeOf = new Int32Array(0);
  /** Outside production, by index, its subject, for the check that a bound does not clip a signal. */
  refs: (WeakRef<object> | I | undefined)[] | null = null;
  /**
   * While a bounded fill reads the subject at an index, that index, so `around` need not look it up;
   * else -1. It holds for `curSubject` alone: a patch the fill runs may probe another subject.
   */
  cur = -1;
  /** The subject at `cur`, while it is set. */
  curSubject: unknown = undefined;
  /** Indices a subject left, for `place` to hand out again. */
  free: number[] = [];
  /** Indices held for subjects dropped while a seek back may still reach the drop. */
  private parked: Parked<I>[] = [];
  /** Whether `xy` is the mix's own, grown as `place` hands out indices, rather than the array `plot` was given. */
  owned = true;
  /**
   * By index, the token its object subject is registered under: a reused index never hears of an
   * old subject's collection.
   */
  private tokens: ({ i: number } | undefined)[] = [];
  private registry: FinalizationRegistry<{ i: number }> | null = null;

  constructor(
    private readonly slotOf: (subject: I) => number,
    private readonly keepRefs: boolean,
  ) {
    super();
    this.refs = keepRefs ? [] : null;
  }

  /**
   * Takes the host's subjects and positions, `axes` numbers a subject; `xy` is read in place, so a
   * move needs only `moved`.
   */
  set(list: readonly I[], xy: Float64Array, cell: number, axes: number): void {
    const n = list.length;
    this.at = new Store<I, number>();
    for (let i = 0; i < n; i++) this.at.set(list[i] as I, i);
    this.slots = new Int32Array(Math.max(n, 16)).fill(-1);
    this.placeOf.fill(-1);
    this.refs = this.keepRefs ? [] : null;
    this.tokens = [];
    this.free = [];
    this.parked = [];
    this.viewed = null;
    for (let i = 0; i < n; i++) {
      const subject = list[i] as I;
      // A subject listed twice is at its last index.
      if (this.at.get(subject) !== i) continue;
      this.hold(subject, i);
    }
    this.n = n;
    this.axes = axes;
    this.xy = xy;
    this.owned = false;
    this.cell = cell;
    this.dirty = true;
  }

  /** `subject`'s index: the one it has, or a new one, a freed index first. */
  place(subject: I): number {
    const had = this.at.get(subject);
    if (had !== undefined) return had;
    const i = this.free.pop() ?? this.n++;
    this.room(i + 1);
    this.at.set(subject, i);
    this.hold(subject, i);
    if (this.owned) this.put(i, Number.NaN, Number.NaN, Number.NaN);
    return i;
  }

  private hold(subject: I, i: number): void {
    const slot = this.slotOf(subject);
    if (slot >= 0) this.numbered(slot, i);
    const object = typeof subject === 'object' && subject !== null;
    if (this.refs !== null) this.refs[i] = object ? new WeakRef(subject as object) : subject;
    if (!object) return;
    const token = { i };
    this.tokens[i] = token;
    this.registry ??= new FinalizationRegistry((t) => {
      if (this.tokens[t.i] === t) this.release(t.i);
    });
    this.registry.register(subject as object, token, token);
  }

  /** Room for indices below `n`; the mix's own positions start as no position, NaN. */
  private room(n: number): void {
    if (this.slots.length < n) {
      const slots = new Int32Array(Math.max(n, this.slots.length * 2)).fill(-1);
      slots.set(this.slots);
      this.slots = slots;
    }
    const a = this.axes;
    if (this.owned && this.xy.length < a * n) {
      const xy = new Float64Array(Math.max(a * n, this.xy.length * 2, 32)).fill(Number.NaN);
      xy.set(this.xy);
      this.xy = xy;
    }
  }

  /** The lanes numbered `subject`: its place, if it has one, reads the number from now on. */
  number(subject: I, slot: number): void {
    const i = this.at.get(subject);
    if (i !== undefined) this.numbered(slot, i);
  }

  private numbered(slot: number, i: number): void {
    if (slot >= this.placeOf.length) {
      const grown = new Int32Array(Math.max(slot + 1, this.placeOf.length * 2, 64)).fill(-1);
      grown.set(this.placeOf);
      this.placeOf = grown;
    }
    this.placeOf[slot] = i;
    this.slots[i] = slot;
  }

  /** The lanes let lane number `slot` go. */
  forgot(slot: number): void {
    if (slot >= this.placeOf.length) return;
    const i = this.placeOf[slot] as number;
    if (i < 0) return;
    this.placeOf[slot] = -1;
    if (this.slots[i] === slot) this.slots[i] = -1;
  }

  /**
   * The host dropped `subject`: its index is freed. Given the drop's frame and mix time, under
   * history, the index and its position are held for it instead, while a seek back may reach it.
   */
  drop(subject: I, when?: { seq: number; t: number; early: boolean }): void {
    const i = this.at.get(subject);
    if (i === undefined) return;
    this.at.delete(subject);
    const token = this.tokens[i];
    if (token !== undefined) this.registry?.unregister(token);
    if (when === undefined) {
      this.release(i);
      return;
    }
    this.parked.push({ subject, i, seq: when.seq, t: when.t, early: when.early });
    this.viewed = null;
    this.tokens[i] = undefined;
    if (this.refs !== null) this.refs[i] = undefined;
    const slot = this.slots[i] as number;
    if (slot >= 0) this.placeOf[slot] = -1;
    this.slots[i] = -1;
  }

  /** Frees the indices held for drops made before mix time `reach`, which no seek back reaches. */
  prune(reach: number): void {
    const parked = this.parked;
    if (parked.length === 0 || !((parked[0] as Parked<I>).t < reach)) return;
    let n = 0;
    while (n < parked.length && (parked[n] as Parked<I>).t < reach)
      this.release((parked[n++] as Parked<I>).i);
    parked.splice(0, n);
    this.viewed = null;
  }

  /** A seek back to the end of frame `seq`: a subject dropped after it has its index again. */
  back(seq: number): void {
    const parked = this.parked;
    if (parked.length === 0) return;
    // Latest first, so a subject dropped twice since ends at the index it had before the first.
    for (let n = parked.length - 1; n >= 0; n--) {
      const p = parked[n] as Parked<I>;
      if (p.seq <= seq) continue;
      const had = this.at.get(p.subject);
      if (had !== undefined) this.drop(p.subject);
      this.at.set(p.subject, p.i);
      this.hold(p.subject, p.i);
    }
    this.parked = parked.filter((p) => p.seq <= seq);
    this.viewed = null;
  }

  /**
   * The indices as a read back to `cut` finds them: these, or, where a subject was dropped after
   * it, a view giving that subject its index again.
   */
  backTo(cut: Cut): Places<I> {
    if (this.parked.length === 0) return this;
    if (this.viewed?.cut === cut) return this.viewed.view;
    const after = this.parked.filter((p) => !within(cut, p.seq, p.early));
    const view = after.length === 0 ? this : this.viewWith(after);
    this.viewed = { cut, view };
    return view;
  }

  /** The last view `backTo` made, and the cut it read, until an index is held or given back. */
  private viewed: { cut: Cut; view: Places<I> } | null = null;

  private viewWith(after: Parked<I>[]): Places<I> {
    const base = this.at;
    const at = Object.create(base) as Store<I, number>;
    at.get = (subject: I) => {
      for (const p of after) if (p.subject === subject) return p.i;
      return base.get(subject);
    };
    const view = Object.create(this) as Places<I>;
    view.at = at;
    return view;
  }

  /** A view in which `subject` has no index, for a read's copy that drops it: the copy shares its indices. */
  without(subject: I): Places<I> {
    const base = this.at;
    const at = Object.create(base) as Store<I, number>;
    at.get = (s: I) => (s === subject ? undefined : base.get(s));
    const view = Object.create(this) as Places<I>;
    view.at = at;
    return view;
  }

  /** Frees index `i`, its subject dropped or collected. */
  private release(i: number): void {
    this.tokens[i] = undefined;
    if (this.refs !== null) this.refs[i] = undefined;
    const slot = this.slots[i] as number;
    if (slot >= 0) this.placeOf[slot] = -1;
    this.slots[i] = -1;
    // The host's own array is the host's: a reused index reads whatever it holds there.
    if (this.owned) this.put(i, Number.NaN, Number.NaN, Number.NaN);
    this.free.push(i);
  }

  /** The subject at index `i`, where it is still held; only outside production. */
  subjectAt(i: number): I | undefined {
    const ref = this.refs?.[i];
    const s = ref instanceof WeakRef ? (ref.deref() as I | undefined) : ref;
    return s !== undefined && this.at.get(s) === i ? s : undefined;
  }

  /** Whether `subject` is within `r` of (`x`, `y`, `z`), by the same test `query` makes. */
  inside(subject: I, x: number, y: number, z: number, r2: number): boolean {
    const i = this.at.get(subject);
    if (i === undefined || !this.has(i)) return false;
    return this.d2(i, x, y, z) <= r2;
  }

  /** Whether the positions have room for index `i`. */
  has(i: number): boolean {
    return this.axes * (i + 1) <= this.xy.length;
  }
}
