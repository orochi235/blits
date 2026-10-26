import { Grid } from './grid.js';
import { Store } from './store.js';

/**
 * Where the host says each subject is, by the subject's place in the list `plot` was given, over
 * `Grid`. Subjects are held as the rest of the mix holds them: an object weakly, anything else until
 * `drop`.
 */
export class Places<I> extends Grid {
  /** By subject, its place. */
  at = new Store<I, number>();
  /** By place, its subject's lane number, -1 for one with none or a subject let go. */
  slots = new Int32Array(0);
  /** By lane number, the place it was put in `slots` at, -1 for none. */
  placeOf = new Int32Array(0);
  /** Outside production, by place, its subject, for the check that a circle does not clip a signal. */
  refs: (WeakRef<object> | I | undefined)[] | null = null;
  /** While a bounded fill reads the subject at a place, that place, so `near` need not look it up; else -1. */
  cur = -1;

  /**
   * Takes the host's subjects and positions; `xy` is read in place, so a move needs only `moved`.
   * `slotOf` gives a subject's lane number, -1 for none.
   */
  set(
    list: readonly I[],
    xy: Float64Array,
    cell: number,
    slotOf: (subject: I) => number,
    keepRefs: boolean,
  ): void {
    const n = list.length;
    this.at = new Store<I, number>();
    for (let i = 0; i < n; i++) this.at.set(list[i] as I, i);
    if (this.slots.length < n) this.slots = new Int32Array(n);
    this.slots.fill(-1);
    this.placeOf.fill(-1);
    for (let i = 0; i < n; i++) {
      const subject = list[i] as I;
      // A subject listed twice is at its last place.
      if (this.at.get(subject) !== i) continue;
      const slot = slotOf(subject);
      if (slot >= 0) this.numbered(slot, i);
    }
    this.refs = keepRefs
      ? list.map((s) => (typeof s === 'object' && s !== null ? new WeakRef(s as object) : s))
      : null;
    this.n = n;
    this.xy = xy;
    this.cell = cell;
    this.dirty = true;
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

  /** The host dropped `subject`: it has no place until plotted again. */
  drop(subject: I): void {
    const i = this.at.get(subject);
    if (i === undefined) return;
    this.at.delete(subject);
    if (this.refs !== null) this.refs[i] = undefined;
  }

  /** The subject at place `i`, where it is still held; only outside production. */
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
