// Each a copy of `a` at the front of a new array `n` long, kept apart by type so each call site
// sees one kind of array. How far to grow stays the caller's call.

/** `a`'s numbers in a new array `n` long, `fill` after them; for no `a`, all `fill`. */
export function grown(a: Float64Array | null, n: number, fill = 0): Float64Array<ArrayBuffer> {
  const b = new Float64Array(n);
  if (fill !== 0) b.fill(fill);
  if (a !== null) b.set(a);
  return b;
}

/** `a`'s integers in a new array `n` long, 0 after them. */
export function grownInts(a: Int32Array, n: number): Int32Array<ArrayBuffer> {
  const b = new Int32Array(n);
  b.set(a);
  return b;
}

/** `a`'s words in a new array `n` long, 0 after them; for no `a`, all 0. */
export function grownWords(a: Uint32Array | null, n: number): Uint32Array<ArrayBuffer> {
  const b = new Uint32Array(n);
  if (a !== null) b.set(a);
  return b;
}
