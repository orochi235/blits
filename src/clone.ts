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
  met.length = 0;
  return quick === slow ? structuredClone(v) : (quick as T);
}

/** The objects one `clone` has met: one met twice is shared, which `structuredClone` keeps. */
const met: object[] = [];

function copied(v: unknown, depth: number): unknown {
  if (typeof v === 'symbol' || typeof v === 'function') return slow;
  if (typeof v !== 'object' || v === null) return v;
  if (depth === 0 || met.includes(v)) return slow;
  met.push(v);
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

/** A copy a fold may write into: arrays, typed arrays and plain objects copied, the rest as is. */
export function copy(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) return [...v];
  if (ArrayBuffer.isView(v)) return (v as unknown as { slice(): unknown }).slice();
  return plainObject(v) ? clone(v) : v;
}

/** Whether `copy` can copy `v` faithfully, when it is an object. */
export function copyable(v: object): boolean {
  return Array.isArray(v) || ArrayBuffer.isView(v) || plainObject(v);
}

function plainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
