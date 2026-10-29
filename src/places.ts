import { Grid } from './grid.js';
import { Store } from './store.js';

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
  /** While a bounded fill reads the subject at an index, that index, so `around` need not look it up; else -1. */
  cur = -1;
  /** Indices a subject left, for `place` to hand out again. */
  free: number[] = [];
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

  /** Takes the host's subjects and positions; `xy` is read in place, so a move needs only `moved`. */
  set(list: readonly I[], xy: Float64Array, cell: number): void {
    const n = list.length;
    this.at = new Store<I, number>();
    for (let i = 0; i < n; i++) this.at.set(list[i] as I, i);
    this.slots = new Int32Array(Math.max(n, 16)).fill(-1);
    this.placeOf.fill(-1);
    this.refs = this.keepRefs ? [] : null;
    this.tokens = [];
    this.free = [];
    for (let i = 0; i < n; i++) {
      const subject = list[i] as I;
      // A subject listed twice is at its last index.
      if (this.at.get(subject) !== i) continue;
      this.hold(subject, i);
    }
    this.n = n;
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
    if (this.owned) this.put(i, Number.NaN, Number.NaN);
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
    if (this.owned && this.xy.length < 2 * n) {
      const xy = new Float64Array(Math.max(2 * n, this.xy.length * 2, 32)).fill(Number.NaN);
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

  /** The host dropped `subject`: its index is freed. */
  drop(subject: I): void {
    const i = this.at.get(subject);
    if (i === undefined) return;
    this.at.delete(subject);
    const token = this.tokens[i];
    if (token !== undefined) this.registry?.unregister(token);
    this.release(i);
  }

  /** Frees index `i`, its subject dropped or collected. */
  private release(i: number): void {
    this.tokens[i] = undefined;
    if (this.refs !== null) this.refs[i] = undefined;
    const slot = this.slots[i] as number;
    if (slot >= 0) this.placeOf[slot] = -1;
    this.slots[i] = -1;
    // The host's own array is the host's: a reused index reads whatever it holds there.
    if (this.owned) this.put(i, Number.NaN, Number.NaN);
    this.free.push(i);
  }

  /** The subject at index `i`, where it is still held; only outside production. */
  subjectAt(i: number): I | undefined {
    const ref = this.refs?.[i];
    const s = ref instanceof WeakRef ? (ref.deref() as I | undefined) : ref;
    return s !== undefined && this.at.get(s) === i ? s : undefined;
  }

  /** Whether `subject` is within `r` of (`cx`, `cy`), by the same test `query` makes. */
  inside(subject: I, cx: number, cy: number, r2: number): boolean {
    const i = this.at.get(subject);
    if (i === undefined || 2 * i + 1 >= this.xy.length) return false;
    const dx = (this.xy[2 * i] as number) - cx;
    const dy = (this.xy[2 * i + 1] as number) - cy;
    return dx * dx + dy * dy <= r2;
  }
}
