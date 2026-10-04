/** Numbers per slab: small enough that a voice outliving the rest of its slab pins little. */
const SLAB = 256;

let slab = new Float64Array(SLAB);
let used = 0;

/**
 * A zeroed run of `n` numbers. A short one is a view on a shared slab, since a typed array past 64
 * bytes gets a backing store of its own, which a motion patch per voice paid in time and memory.
 */
export function carve(n: number): Float64Array {
  if (n > SLAB / 4) return new Float64Array(n);
  if (used + n > SLAB) {
    slab = new Float64Array(SLAB);
    used = 0;
  }
  const run = slab.subarray(used, used + n);
  used += n;
  return run;
}
