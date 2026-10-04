/** What every store reads before its first write: never written, so always empty. */
const noWeak = new WeakMap<object, never>();
const noStrong = new Map<never, never>();

/**
 * Per-subject storage keyed by identity. Objects go in a WeakMap and are forgotten when the host
 * drops them; anything else — a string id, the unit subject of a mix with no subject dimension —
 * goes in a Map that only `drop` and `clear` empty, which is why a host keying by value should
 * call `drop`. Each map is made when first written, since a mix holds a store per voice and patch;
 * until then it is a shared empty one, so the field always holds a map.
 */
export class Store<K, V> {
  private weak: WeakMap<object, V> = noWeak;
  private strong: Map<K, V> = noStrong;

  get(key: K): V | undefined {
    return typeof key === 'object' && key !== null
      ? this.weak.get(key as object)
      : this.strong.get(key);
  }

  set(key: K, value: V): void {
    if (typeof key === 'object' && key !== null) {
      if (this.weak === noWeak) this.weak = new WeakMap();
      this.weak.set(key as object, value);
    } else {
      if (this.strong === noStrong) this.strong = new Map();
      this.strong.set(key, value);
    }
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
