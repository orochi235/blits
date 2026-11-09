/** Whether `a` and `b` agree to within `tol` of the larger of them, or of 1 near 0. */
export const nearly = (a: number, b: number, tol: number): boolean =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
