/**
 * A stretch of mix time a voice's share of a channel bends in. With `g`, that share is a multiple
 * of `g` there plus a line; without one, it bends in a way the trace cannot name.
 */
export type Bent =
  | readonly [lo: number, hi: number]
  | readonly [lo: number, hi: number, g: (t: number) => number];

/**
 * Where the reads that fit a bent stretch fall, as fractions of it: inside, and spread unevenly so
 * an easing that is even about the middle, or steps, cannot look straight at them.
 */
const fitAt = (i: number, n: number): number => (i + 0.3819660113) / (n + 0.7639320225);
/** The fraction of a bent stretch read once more, to check the fit. */
const CHECK = 0.5414213562;
/** How far inside a stretch, as a fraction of it, a bend's ends are read. */
const EDGE = 1e-9;
/** Where each bend is weighed before any value is read: the fit's points and the check. */
const PROBES = [...Array.from({ length: 12 }, (_, i) => fitAt(i, 12)), CHECK];

/**
 * How each of `curves` stands off its own chord from `a` to `b`, as functions of the fraction `u`
 * along, scaled to about 1: those straight here, as a curve may be over part of its own, and those
 * the others already make, are left out. Null where one cannot be named.
 */
export function bowsOver(
  a: number,
  b: number,
  curves: readonly Bent[],
): ((u: number) => number)[] | null {
  const span = b - a;
  const bows: ((u: number) => number)[] = [];
  const basis: number[][] = [];
  for (const c of curves) {
    const g = c[2];
    if (g === undefined) return null;
    // Each end read just inside, as a bend may end where its voice jumps; 0 at both ends.
    const ga = g(a + span * EDGE);
    const gb = g(b - span * EDGE);
    const raw = (u: number): number =>
      u <= 0 || u >= 1 ? 0 : g(a + u * span) - ga - ((u - EDGE) / (1 - 2 * EDGE)) * (gb - ga);
    const seen = PROBES.map(raw);
    const scale = Math.max(...seen.map(Math.abs));
    if (!(scale > 1e-12 * Math.max(1, Math.abs(ga), Math.abs(gb)))) continue;
    // What is left of it once the bends kept already are taken out, by Gram-Schmidt.
    const left = seen.map((v) => v / scale);
    for (const q of basis) {
      let dot = 0;
      for (let i = 0; i < left.length; i++) dot += (left[i] as number) * (q[i] as number);
      for (let i = 0; i < left.length; i++) left[i] = (left[i] as number) - dot * (q[i] as number);
    }
    const norm = Math.sqrt(left.reduce((s, v) => s + v * v, 0));
    if (!(norm > 1e-9)) continue;
    basis.push(left.map((v) => v / norm));
    bows.push((u) => raw(u) / scale);
  }
  return bows;
}

/**
 * Fits a stretch from `a` to `b` as a line plus a multiple of each of `bows`, `flat` where every
 * multiple is 0. The value is read at as many points inside as there are unknowns, and once more
 * to check; null where the reads do not pin the fit or the check misses, so the stretch is read on
 * the grid.
 */
export function fitBent(
  a: number,
  b: number,
  bows: readonly ((u: number) => number)[],
  value: (t: number) => number,
): { va: number; vb: number; off: (u: number) => number; flat: boolean } | null {
  const span = b - a;
  const k = bows.length;
  const n = k + 2;
  const m: number[][] = [];
  const rhs: number[] = [];
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const u = fitAt(i, n);
    const v = value(a + u * span);
    if (!Number.isFinite(v)) return null;
    m.push([1 - u, u, ...bows.map((bow) => bow(u))]);
    rhs.push(v);
    scale = Math.max(scale, Math.abs(v));
  }
  const x = solve(m, rhs);
  if (x === null) return null;
  const off = (u: number): number => {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += (x[2 + j] as number) * (bows[j] as (u: number) => number)(u);
    return sum;
  };
  const va = x[0] as number;
  const vb = x[1] as number;
  const check = value(a + CHECK * span);
  const fitted = va + (vb - va) * CHECK + off(CHECK);
  const tol = 1e-9 * Math.max(1, scale);
  if (!(Math.abs(check - fitted) <= tol)) return null;
  let most = 0;
  for (let j = 0; j < k; j++) most = Math.max(most, Math.abs(x[2 + j] as number));
  return { va, vb, off, flat: most <= tol };
}

/** Solves `m x = rhs` by elimination with partial pivoting; null where `m` is near singular. */
function solve(m: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[p] as number[])[c] as number))
        p = r;
    const pivot = (m[p] as number[])[c] as number;
    if (!(Math.abs(pivot) > 1e-12)) return null;
    [m[c], m[p]] = [m[p] as number[], m[c] as number[]];
    [rhs[c], rhs[p]] = [rhs[p] as number, rhs[c] as number];
    const top = m[c] as number[];
    for (let r = c + 1; r < n; r++) {
      const row = m[r] as number[];
      const f = (row[c] as number) / pivot;
      if (f === 0) continue;
      for (let k = c; k < n; k++) row[k] = (row[k] as number) - f * (top[k] as number);
      rhs[r] = (rhs[r] as number) - f * (rhs[c] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] as number[];
    let sum = rhs[r] as number;
    for (let k = r + 1; k < n; k++) sum -= (row[k] as number) * (x[k] as number);
    x[r] = sum / (row[r] as number);
  }
  return x;
}
