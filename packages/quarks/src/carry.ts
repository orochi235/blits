// Error-free transforms: each returns a result and the rounding error it dropped, exactly.
const SPLIT = 134217729; // 2^27 + 1

let err = 0;

function twoSum(a: number, b: number): number {
  const s = a + b;
  const v = s - a;
  err = a - (s - v) + (b - v);
  return s;
}

function twoProduct(a: number, b: number): number {
  const p = a * b;
  let t = SPLIT * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b);
  const bl = b - bh;
  err = ah * bh - p + ah * bl + al * bh + al * bl;
  return p;
}

/**
 * Particle-milliseconds owed and not yet emitted, held as `hi + lo` in twice a double's precision,
 * so `rate × dt` summed over any run of frames floors where exact arithmetic would.
 */
export class Carry {
  private hi = 0;
  private lo = 0;

  add(rate: number, dt: number): void {
    const p = twoProduct(rate, dt);
    const pe = err;
    const s = twoSum(this.hi, p);
    const se = err;
    const t = twoSum(this.lo, pe);
    this.set(s, se + t + err);
  }

  /** Takes the whole particles owed out of the carry and returns how many. */
  take(): number {
    let n = Math.max(0, Math.floor(this.hi / 1000));
    while (n > 0 && !this.reaches(n * 1000)) n--;
    while (this.reaches((n + 1) * 1000)) n++;
    if (n > 0) {
      const s = twoSum(this.hi, -n * 1000);
      this.set(s, err + this.lo);
    }
    return n;
  }

  private reaches(k: number): boolean {
    return this.hi > k || (this.hi === k && this.lo >= 0);
  }

  private set(hi: number, lo: number): void {
    this.hi = hi + lo;
    this.lo = lo - (this.hi - hi);
  }
}

/**
 * Particles owed, summed in plain doubles as a host's frame loop sums `rate * dt`, so it emits on
 * the frames that loop does, rounding included.
 */
export class Sum {
  private owed = 0;

  add(rate: number, dt: number): void {
    this.owed += rate * (dt / 1000);
  }

  take(): number {
    const n = Math.floor(this.owed);
    this.owed -= n;
    return n;
  }
}
