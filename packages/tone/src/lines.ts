/** The shortest piece, audio ms, a curve is split into. */
const LEAST = 0.25;
/** The longest piece, audio ms, a curve is written as before its fit is checked at all. */
const MOST = 40;
/** How far, as a share of the curve's own size, a line may stand off it. */
const CLOSE = 1e-4;

const QUARTERS = [0.25, 0.5, 0.75] as const;

/**
 * Writes `f` from audio ms `a0` to `a1` as straight lines, through `put(value, at)` for each point
 * strictly between, splitting in half wherever a line stands further off `f` at its quarters than
 * `CLOSE` of `size`. `f(a0)` is `v0` and `f(a1)` is `v1`; neither end is put.
 */
export function lines(
  f: (a: number) => number,
  a0: number,
  v0: number,
  a1: number,
  v1: number,
  size: number,
  put: (value: number, at: number) => void,
): void {
  const tol = CLOSE * size;
  if (!(tol > 0)) return;
  const split = (a: number, va: number, b: number, vb: number): void => {
    const h = b - a;
    if (!(h > LEAST)) return;
    const q = QUARTERS.map((k) => f(a + h * k));
    if (
      h <= MOST &&
      q.every((v, i) => Math.abs(v - (va + (vb - va) * (QUARTERS[i] as number))) <= tol)
    )
      return;
    const mid = a + h / 2;
    const vm = q[1] as number;
    split(a, va, mid, vm);
    put(vm, mid);
    split(mid, vm, b, vb);
  };
  split(a0, v0, a1, v1);
}
