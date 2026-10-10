/** What every store reads before its first write: never written, so always empty. */
const noWeak = new WeakMap<object, never>();
const noStrong = new Map<never, never>();

/**
 * Per-subject storage keyed by identity. Objects go in a WeakMap and are forgotten when the host
 * drops them; anything else — a string id, the unit subject of a mix with no subject dimension —
 * goes in a Map that only `delete` and `clear` empty, which is why a host keying by value should
 * call `Mix.drop`. Each map is made when first written, since a mix holds a store per voice and
 * patch; until then it is a shared empty one, so the field always holds a map.
 */
export class Store<K, V> {
  private weak: WeakMap<object, V> = noWeak;
  private strong: Map<K, V> = noStrong;
  /**
   * The first key that is not an object, and its value, held here until a second comes: a voice of
   * one subject keyed by id would otherwise spend a Map's smallest table on it.
   */
  private oneKey: K | typeof none = none;
  private oneValue: V | undefined = undefined;

  get(key: K): V | undefined {
    if (typeof key === 'object' && key !== null) return this.weak.get(key as object);
    return same(this.oneKey, key) ? this.oneValue : this.strong.get(key);
  }

  set(key: K, value: V): void {
    if (typeof key === 'object' && key !== null) {
      if (this.weak === noWeak) this.weak = new WeakMap();
      this.weak.set(key as object, value);
      return;
    }
    if (this.strong === noStrong && (this.oneKey === none || same(this.oneKey, key))) {
      this.oneKey = key;
      this.oneValue = value;
      return;
    }
    if (this.strong === noStrong) this.strong = new Map();
    if (this.oneKey !== none) {
      this.strong.set(this.oneKey as K, this.oneValue as V);
      this.oneKey = none;
      this.oneValue = undefined;
    }
    this.strong.set(key, value);
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): void {
    if (typeof key === 'object' && key !== null) this.weak.delete(key as object);
    else if (same(this.oneKey, key)) {
      this.oneKey = none;
      this.oneValue = undefined;
    } else this.strong.delete(key);
  }

  clear(): void {
    this.oneKey = none;
    this.oneValue = undefined;
    this.strong.clear();
  }
}

/** No key held inline. */
const none: unique symbol = Symbol('none');

/** A Map's key equality, SameValueZero: NaN finds NaN. */
const same = (a: unknown, b: unknown): boolean => a === b || Object.is(a, b);
