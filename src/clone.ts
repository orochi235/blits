// Every runtime blits targets has it; the package's lib setting names no environment.
declare function structuredClone<T>(value: T): T;

const slow: unique symbol = Symbol('slow');

/**
 * `structuredClone(v)`, made directly for what records mostly hold — numbers, strings, and plain
 * objects and arrays of them two deep — with what `structuredClone` would give; anything else, or
 * anything it would refuse, goes to it. A read back copies a record per voice and subject.
 */
export function clone<T>(v: T): T {
  const quick = copied(v, 2);
  for (let i = 0; i < metCount; i++) met[i] = undefined;
  metCount = 0;
  return quick === slow ? structuredClone(v) : (quick as T);
}

/**
 * The objects one `clone` has met: one met twice is shared, which `structuredClone` keeps. Cleared
 * by hand, as `length = 0` frees the array's storage and the next push allocates it again.
 */
const met: (object | undefined)[] = [];
let metCount = 0;

function hasMet(v: object): boolean {
  for (let i = 0; i < metCount; i++) if (met[i] === v) return true;
  return false;
}

function copied(v: unknown, depth: number): unknown {
  if (typeof v === 'symbol' || typeof v === 'function') return slow;
  if (typeof v !== 'object' || v === null) return v;
  if (depth === 0 || hasMet(v)) return slow;
  met[metCount++] = v;
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) return slow;
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) return slow;
      const x = copied(v[i], depth - 1);
      if (x === slow) return slow;
      out.push(x);
    }
    // A property besides the elements, which `structuredClone` keeps.
    let keys = 0;
    for (const _ in v) if (++keys > v.length) return slow;
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return slow;
  const out: Record<string, unknown> = {};
  for (const k in v) {
    if (k === '__proto__') return slow;
    const x = copied((v as Record<string, unknown>)[k], depth - 1);
    if (x === slow) return slow;
    out[k] = x;
  }
  return out;
}

/**
 * `clone(v)`, written over `into` where `into` is a plain object of data properties nothing else
 * holds, with the same keys in the same order as `v`, and every value of `v` is a primitive; else
 * a new `clone(v)`, and `into` may be partly written.
 */
export function cloneInto<T>(v: T, into: unknown): T {
  if (typeof v !== 'object' || v === null || typeof into !== 'object' || into === null)
    return clone(v);
  if (Array.isArray(v) || Object.getPrototypeOf(into) !== Object.prototype) return clone(v);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return clone(v);
  let n = 0;
  for (const k in into) intoKeys[n++] = k;
  const out = into as Record<string, unknown>;
  let i = 0;
  for (const k in v) {
    if (i === n || intoKeys[i] !== k || k === '__proto__') return clone(v);
    const x = (v as Record<string, unknown>)[k];
    if ((typeof x === 'object' && x !== null) || typeof x === 'function' || typeof x === 'symbol')
      return clone(v);
    out[k] = x;
    i++;
  }
  return i === n ? (into as T) : clone(v);
}

/** `into`'s keys for one `cloneInto`, kept between calls so reading them allocates nothing. */
const intoKeys: string[] = [];

/** A copy a fold may write into: arrays, typed arrays and plain objects copied, the rest as is. */
export function copy(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) return [...v];
  if (ArrayBuffer.isView(v)) return (v as unknown as { slice(): unknown }).slice();
  return plainObject(v) ? clone(v) : v;
}

/**
 * A value that starts a channel no fold writes into: only `merged` touches it after, and that
 * writes into arrays alone, so an object is the patch's own, not a copy made each frame.
 */
export function first(v: unknown): unknown {
  return Array.isArray(v) ? [...v] : v;
}

/** Whether `copy` can copy `v` faithfully, when it is an object. */
export function copyable(v: object): boolean {
  return Array.isArray(v) || ArrayBuffer.isView(v) || plainObject(v);
}

function plainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
