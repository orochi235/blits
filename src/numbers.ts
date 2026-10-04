/** What a number's subject is once it has none: released, or let go by the host. */
export const absent: unique symbol = Symbol('absent');

/** What `refs` holds for a subject that is itself `undefined`, the unit subject of some mixes. */
const unit: unique symbol = Symbol('unit');

/**
 * Hands each subject a small number to index flat arrays by, and takes it back when the subject is
 * released or, for an object, when the host lets it go. Objects are held weakly, as `Store` holds
 * them, so numbering one never keeps it alive.
 */
export class Numbers<I> {
  private next = 0;
  private readonly free: number[] = [];
  /** By number: the subject, a weak reference to it, or undefined for a number not in use. */
  private readonly refs: (I | WeakRef<object> | typeof unit | undefined)[] = [];
  /**
   * Made at the second object numbered, when the first is registered too: a motion patch per voice
   * holds a `Numbers`, mostly for one subject, whose collection frees nothing worth a registry.
   * Each object's weak reference is also its token, so a number reused after its subject is
   * released never hears of the old one's collection.
   */
  private registry: FinalizationRegistry<number> | null = null;
  /** The one object numbered before there was a registry, and its number. */
  private lone: WeakRef<object> | null = null;
  private loneSlot = -1;

  constructor(private readonly gone: (slot: number) => void) {}

  /** One past the highest number handed out, so a loop over 0..size meets every live one. */
  get size(): number {
    return this.next;
  }

  take(subject: I): number {
    const slot = this.free.pop() ?? this.next++;
    if (typeof subject === 'object' && subject !== null) {
      const ref = new WeakRef(subject as object);
      this.refs[slot] = ref;
      if (this.registry === null) {
        if (this.lone === null) {
          this.lone = ref;
          this.loneSlot = slot;
          return slot;
        }
        this.registry = new FinalizationRegistry<number>((slot) => this.release(slot));
        const first = this.lone.deref();
        if (first !== undefined) this.registry.register(first, this.loneSlot, this.lone);
        this.lone = null;
      }
      this.registry.register(subject as object, slot, ref);
    } else this.refs[slot] = subject === undefined ? unit : subject;
    return slot;
  }

  subject(slot: number): I | typeof absent {
    const ref = this.refs[slot];
    if (ref === undefined) return absent;
    if (ref === unit) return undefined as I;
    if (ref instanceof WeakRef) {
      const s = ref.deref();
      return s === undefined ? absent : (s as I);
    }
    return ref as I;
  }

  release(slot: number): void {
    const ref = this.refs[slot];
    if (ref === undefined) return;
    if (ref === this.lone) this.lone = null;
    else if (ref instanceof WeakRef) this.registry?.unregister(ref);
    this.refs[slot] = undefined;
    this.gone(slot);
    this.free.push(slot);
  }
}
