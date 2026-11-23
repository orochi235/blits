/** What a number's subject is once it has none: released, or let go by the host. */
export const absent: unique symbol = Symbol('absent');

/** The fewest cells left over for live subjects before a registry is made afresh. */
const STALE = 1024;

/** What `refs` holds for a subject that is itself `undefined`, the unit subject of some mixes. */
const unit: unique symbol = Symbol('unit');

/**
 * Hands each subject a small number to index flat arrays by, and takes it back when the subject is
 * released or, for an object, when the host lets it go. Objects are held weakly, as `Store` holds
 * them, so numbering one never keeps it alive.
 */
export class Numbers<I> {
  private next = 0;
  /** Numbers released for reuse; null until one is, as most patches never release one. */
  private free: number[] | null = null;
  /** By number: the subject, a weak reference to it, or undefined for a number not in use. */
  // Room for one: an empty array written at 0 reserves 17, and most patches number one subject.
  private readonly refs: (I | WeakRef<object> | typeof unit | undefined)[] = [undefined];
  /**
   * Made at the second object numbered, when the first is registered too: a motion patch per voice
   * holds a `Numbers`, mostly for one subject, whose collection frees nothing worth a registry.
   * Registered with no unregister token, which costs a token table entry each (about 0.17 µs a
   * subject at 1M): a cell outlives its number's release, so a collection is acted on only where
   * the number still holds a collected subject, and the cells left over are bounded by `stale`.
   */
  private registry: FinalizationRegistry<number> | null = null;
  /** Cells registered for a live subject whose number was since released or moved. */
  private stale = 0;
  /** The one object numbered before there was a registry, and its number. */
  private lone: WeakRef<object> | null = null;
  private loneSlot = -1;

  /** Takes the owner rather than a callback, which would cost a closure and its context per patch. */
  constructor(private owner: { forget(slot: number): void }) {}

  /** Hands the numbers to a new owner, which hears of every release from now on. */
  adopt(owner: { forget(slot: number): void }): void {
    this.owner = owner;
  }

  /** One past the highest number handed out, so a loop over 0..size meets every live one. */
  get size(): number {
    return this.next;
  }

  take(subject: I): number {
    const slot = this.free?.pop() ?? this.next++;
    let dead = -1;
    if (typeof subject === 'object' && subject !== null) {
      const ref = new WeakRef(subject as object);
      this.refs[slot] = ref;
      if (this.registry === null) {
        if (this.lone === null) {
          this.lone = ref;
          this.loneSlot = slot;
          return slot;
        }
        this.registry = this.createRegistry();
        const first = this.lone.deref();
        if (first !== undefined) this.registry.register(first, this.loneSlot);
        // Collected with no registry to hear of it: released here, once this subject is numbered.
        else dead = this.loneSlot;
        this.lone = null;
      }
      this.registry.register(subject as object, slot);
    } else this.refs[slot] = subject === undefined ? unit : subject;
    if (dead >= 0) this.release(dead);
    return slot;
  }

  /** Whether `slot` is a number in use, its subject perhaps collected and not yet released. */
  has(slot: number): boolean {
    return this.refs[slot] !== undefined;
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

  /**
   * Hands the subject numbered `from` the free number `to`, and frees `from` without telling the
   * owner, whose stores the caller moves; false, changing nothing, where either does not hold.
   */
  move(from: number, to: number): boolean {
    const ref = this.refs[from];
    const free = this.free;
    if (ref === undefined || to >= this.next || this.refs[to] !== undefined || free === null)
      return false;
    const at = free.lastIndexOf(to);
    if (at < 0) return false;
    let stale = false;
    if (ref instanceof WeakRef) {
      const subject = ref.deref();
      if (subject === undefined) return false;
      if (ref === this.lone) this.loneSlot = to;
      else if (this.registry !== null) {
        this.registry.register(subject, to);
        stale = true;
      }
    }
    free.splice(at, 1);
    free.push(from);
    this.refs[to] = ref;
    this.refs[from] = undefined;
    // After the move, so a fresh registry built here registers the subject at `to`, not `from`.
    if (stale) this.countStale();
    return true;
  }

  release(slot: number): void {
    const ref = this.refs[slot];
    if (ref === undefined) return;
    const live = ref instanceof WeakRef && ref !== this.lone && ref.deref() !== undefined;
    if (ref === this.lone) this.lone = null;
    this.refs[slot] = undefined;
    this.owner.forget(slot);
    if (this.free === null) this.free = [slot];
    else this.free.push(slot);
    if (live) this.countStale();
  }

  private createRegistry(): FinalizationRegistry<number> {
    return new FinalizationRegistry<number>((slot) => {
      const ref = this.refs[slot];
      // A cell left from before a release: its number may hold another subject now, or none.
      if (ref instanceof WeakRef && ref.deref() === undefined) this.release(slot);
    });
  }

  /**
   * Counts a cell left registered for a live subject, and past as many as there are numbers, puts
   * every live object in a fresh registry, so taking and releasing one subject over and over holds
   * no more cells than numbers. Dropping the old registry drops its pending callbacks, so a number
   * whose subject was already collected is released here.
   */
  private countStale(): void {
    if (++this.stale <= Math.max(STALE, this.next)) return;
    this.stale = 0;
    const registry = this.createRegistry();
    this.registry = registry;
    const refs = this.refs;
    for (let slot = 0; slot < this.next; slot++) {
      const ref = refs[slot];
      if (!(ref instanceof WeakRef) || ref === this.lone) continue;
      const subject = ref.deref();
      if (subject === undefined) this.release(slot);
      else registry.register(subject, slot);
    }
  }
}
