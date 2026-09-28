/**
 * Per-subject storage keyed by identity. Objects go in a WeakMap and are forgotten when the host
 * drops them; anything else — a string id, the unit subject of a mix with no subject dimension —
 * goes in a Map that only `drop` and `clear` empty, which is why a host keying by value should
 * call `drop`.
 */
export class Store<K, V> {
  private readonly weak = new WeakMap<object, V>();
  private readonly strong = new Map<K, V>();

  get(key: K): V | undefined {
    return typeof key === 'object' && key !== null
      ? this.weak.get(key as object)
      : this.strong.get(key);
  }

  set(key: K, value: V): void {
    if (typeof key === 'object' && key !== null) this.weak.set(key as object, value);
    else this.strong.set(key, value);
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): void {
    if (typeof key === 'object' && key !== null) this.weak.delete(key as object);
    else this.strong.delete(key);
  }

  clear(): void {
    this.strong.clear();
  }
}
