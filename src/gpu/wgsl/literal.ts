/** The largest finite f32. */
export const MAX_F32 = 3.4028234663852886e38;

/**
 * `x` as a WGSL f32 literal, an infinity as the largest f32 of its sign. Throws a `RangeError` for
 * NaN or a finite number past the largest f32, which WGSL refuses to compile.
 */
export function literal(x: number): string {
  if (x === Infinity) return literal(MAX_F32);
  if (x === -Infinity) return literal(-MAX_F32);
  if (Number.isNaN(x) || !Number.isFinite(Math.fround(x)))
    throw new RangeError(`${x}, past the largest number an f32 holds`);
  const s = `${x}`;
  return /[.e]/.test(s) ? s : `${s}.0`;
}
