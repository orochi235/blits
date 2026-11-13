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

  /** As `get`, where `guess` may be the value for `key`, which a store that can tell spares a lookup. */
  find(key: K, _guess: V): V | undefined {
    return this.get(key);
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

/**
 * A store over another, for a copy that must not write the one it reads: what is set or deleted
 * here stays here, and a key deleted here is no longer read from the one under it.
 */
export class Masked<K, V> extends Store<K, V> {
  private readonly hidden = new Store<K, true>();

  constructor(private readonly under: Store<K, V>) {
    super();
  }

  override get(key: K): V | undefined {
    return super.get(key) ?? (this.hidden.get(key) ? undefined : this.under.get(key));
  }

  override delete(key: K): void {
    super.delete(key);
    this.hidden.set(key, true);
  }
}

/** No key held inline. */
const none: unique symbol = Symbol('none');

/** A Map's key equality, SameValueZero: NaN finds NaN. */
const same = (a: unknown, b: unknown): boolean => a === b || Object.is(a, b);

/** A store that fills a missing entry from `make` on first ask. */
export class Filled<K, V> extends Store<K, V> {
  /** Keys deleted here, which are made afresh by whoever asks and never again by `make`. */
  private gone: Store<K, true> | null = null;

  constructor(private readonly make: (key: K) => V | undefined) {
    super();
  }

  override get(key: K): V | undefined {
    let v = super.get(key);
    if (v === undefined && this.gone?.get(key) !== true) {
      v = this.make(key);
      if (v !== undefined) super.set(key, v);
    }
    return v;
  }

  override delete(key: K): void {
    super.delete(key);
    this.gone ??= new Store();
    this.gone.set(key, true);
  }
}

/** Where a line of copies stands on one key. */
export interface Stand<V> {
  /** What the copy at `at` holds, or held before deleting it. */
  value: V | undefined;
  /** The latest copy in the line to take the key, by its place there. */
  at: number;
  /** The first copy holding this same value; every copy from here to `at` holds it too. */
  since: number;
  /** Whether the copy at `at` deleted the key. */
  gone: boolean;
}

/**
 * One copy's view of a store kept once for a line of copies, each made from the one before. The
 * copy at `at` takes a key on from the copy before through `make`, given what that copy holds
 * where it is known, so a line read forward keeps one entry a key rather than one a copy. A copy
 * asked about a key a later copy has taken answers what that key's run of copies holds, or from a
 * store of its own.
 */
export class Along<K, V> extends Store<K, V> {
  private back: Store<K, V> | null = null;
  private backGone: Store<K, true> | null = null;

  constructor(
    readonly line: Store<K, Stand<V>>,
    readonly at: number,
    private readonly make: (key: K, before: V | undefined, known: boolean) => V | undefined,
  ) {
    super();
  }

  override get(key: K): V | undefined {
    const e = this.line.get(key);
    const at = this.at;
    if (e !== undefined) {
      if (e.at === at) return e.gone ? undefined : e.value;
      if (e.at > at) return this.behind(key, e);
      if (e.at === at - 1) {
        const v = this.make(key, e.gone ? undefined : e.value, true);
        if (v !== undefined) take(e, v, at);
        return v;
      }
    }
    const v = this.make(key, undefined, false);
    if (v !== undefined) this.set(key, v);
    return v;
  }

  override set(key: K, value: V): void {
    const e = this.line.get(key);
    if (e === undefined) this.line.set(key, { value, at: this.at, since: this.at, gone: false });
    else if (e.at > this.at) {
      this.backGone?.delete(key);
      this.own().set(key, value);
    } else take(e, value, this.at);
  }

  override delete(key: K): void {
    const e = this.line.get(key);
    const at = this.at;
    if (e === undefined) this.line.set(key, { value: undefined, at, since: at, gone: true });
    else if (e.at > at) {
      this.back?.delete(key);
      this.ownGone().set(key, true);
    } else {
      e.at = at;
      e.gone = true;
    }
  }

  private own(): Store<K, V> {
    this.back ??= new Store();
    return this.back;
  }

  private ownGone(): Store<K, true> {
    this.backGone ??= new Store();
    return this.backGone;
  }

  private behind(key: K, e: Stand<V>): V | undefined {
    if (this.backGone?.get(key) === true) return undefined;
    let v = this.back?.get(key);
    if (v !== undefined || this.at >= e.since) return v ?? e.value;
    v = this.make(key, undefined, false);
    if (v !== undefined) this.own().set(key, v);
    return v;
  }
}

function take<V>(e: Stand<V>, value: V, at: number): void {
  if (value !== e.value) e.since = at;
  e.value = value;
  e.at = at;
  e.gone = false;
}
