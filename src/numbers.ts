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
   * Made at the first object numbered: a motion patch per voice holds one, mostly for one subject.
   * Each object's weak reference is also its token, so a number reused after its subject is
   * released never hears of the old one's collection.
   */
  private registry: FinalizationRegistry<number> | null = null;

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
      if (this.registry === null)
        this.registry = new FinalizationRegistry<number>((slot) => this.release(slot));
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
    if (ref instanceof WeakRef) this.registry?.unregister(ref);
    this.refs[slot] = undefined;
    this.gone(slot);
    this.free.push(slot);
  }
}
