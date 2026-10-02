/** What a number's subject is once it has none: released, or let go by the host. */
export const absent: unique symbol = Symbol('absent');

/**
 * Hands each subject a small number to index flat arrays by, and takes it back when the subject is
 * released or, for an object, when the host lets it go. Objects are held weakly, as `Store` holds
 * them, so numbering one never keeps it alive.
 */
export class Numbers<I> {
  private next = 0;
  private readonly free: number[] = [];
  private readonly refs: (I | WeakRef<object> | undefined)[] = [];
  private live = new Uint8Array(0);
  private readonly tokens: (object | undefined)[] = [];
  private readonly registry = new FinalizationRegistry<number>((slot) => this.release(slot));

  constructor(private readonly gone: (slot: number) => void) {}

  /** One past the highest number handed out, so a loop over 0..size meets every live one. */
  get size(): number {
    return this.next;
  }

  take(subject: I): number {
    const slot = this.free.pop() ?? this.next++;
    if (slot >= this.live.length) {
      const grown = new Uint8Array(Math.max(64, this.live.length * 2, slot + 1));
      grown.set(this.live);
      this.live = grown;
    }
    this.live[slot] = 1;
    if (typeof subject === 'object' && subject !== null) {
      this.refs[slot] = new WeakRef(subject as object);
      const token = {};
      this.tokens[slot] = token;
      this.registry.register(subject as object, slot, token);
    } else this.refs[slot] = subject;
    return slot;
  }

  alive(slot: number): boolean {
    return this.live[slot] === 1;
  }

  subject(slot: number): I | typeof absent {
    if (this.live[slot] !== 1) return absent;
    const ref = this.refs[slot];
    if (ref instanceof WeakRef) {
      const s = ref.deref();
      return s === undefined ? absent : (s as I);
    }
    return ref as I;
  }

  release(slot: number): void {
    if (this.live[slot] !== 1) return;
    this.live[slot] = 0;
    const token = this.tokens[slot];
    if (token !== undefined) {
      this.registry.unregister(token);
      this.tokens[slot] = undefined;
    }
    this.refs[slot] = undefined;
    this.gone(slot);
    this.free.push(slot);
  }
}
