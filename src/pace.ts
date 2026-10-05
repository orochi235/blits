import { type Clock, elapsedWith, rateWith, retime, timeWith } from './clock.js';

/**
 * A mix's own rate, as a clock: mix time as a function of host time, which here means the host's
 * timestamp less what `rebase` took out. Each entry is the clock from the host time it took effect,
 * oldest first, and the last is in force; under `history` the entries a read back may reach are
 * kept, and without it only the last. Entries are never changed once logged, so a copy of the log
 * stays as it was.
 */
export class Pace {
  private log: Clock[];

  constructor(
    private readonly keeps: boolean,
    log: Clock[] = [{ anchorNow: 0, anchorElapsed: 0, rate: 1, ramp: null }],
  ) {
    this.log = log;
  }

  private get clock(): Clock {
    return this.log[this.log.length - 1] as Clock;
  }

  /** Set before the first sync, the clock waits to be anchored there, reading host time until then. */
  private get waiting(): boolean {
    return Number.isNaN(this.clock.anchorNow);
  }

  /** Mix time at host time `u`, anchoring a clock set before the first sync there. */
  sync(u: number): number {
    if (this.waiting) this.log = [{ ...this.clock, anchorNow: u, anchorElapsed: u }];
    return this.reading(u);
  }

  /** What the mix clock reads at host time `u`, by the clock in force then. */
  reading(u: number): number {
    if (this.waiting) return u;
    const log = this.log;
    let i = log.length - 1;
    while (i > 0 && (log[i] as Clock).anchorNow > u) i--;
    return elapsedWith(log[i] as Clock, u);
  }

  /**
   * The mix time of something pinned to host time `u`, seen from host time `now`: what the clock
   * will read there, or Infinity where `u` lies ahead and the clock stands still before it, since
   * the moment the mix reaches is then not `u`'s alone.
   */
  at(u: number, now: number): number {
    if (!(u > now) || this.waiting) return this.reading(u);
    const c = this.clock;
    const r = c.ramp;
    const still = r === null ? c.rate <= 0 : r.to <= 0 && u > c.anchorNow + r.over;
    return still ? Number.POSITIVE_INFINITY : elapsedWith(c, u);
  }

  /** The earliest host time the mix clock reads `t`; Infinity where it never will. */
  timeOf(t: number): number {
    if (this.waiting) return t;
    const log = this.log;
    let i = 0;
    while (i + 1 < log.length && t > (log[i + 1] as Clock).anchorElapsed) i++;
    return timeWith(log[i] as Clock, t);
  }

  /** The rate at host time `u`; before the first sync, the rate the first frame starts at. */
  rateAt(u: number): number {
    const c = this.clock;
    if (this.waiting || Number.isNaN(u)) return c.ramp === null ? c.rate : c.ramp.from;
    return rateWith(c, u);
  }

  /** Whether the mix clock stands still from host time `u` on, short of another change. */
  stopped(u: number): boolean {
    const c = this.clock;
    const r = c.ramp;
    if (r === null) return c.rate === 0;
    return r.to === 0 && !this.waiting && u >= c.anchorNow + r.over;
  }

  /**
   * Sets the rate from host time `u`, at once or over `over` host ms, the way a handle sets a
   * voice's. Under history, lets go of the entries a read no longer reaches: those over before mix
   * time `reach`.
   */
  change(u: number, rate: number, over: number, reach: number): void {
    const was = this.clock;
    const next = { ...was };
    if (Number.isNaN(u) || this.waiting) {
      const from = this.rateAt(Number.NaN);
      next.ramp = over > 0 && rate !== from ? { from, to: rate, over } : null;
      next.rate = rate;
      next.anchorNow = Number.NaN;
      this.log = [next];
      return;
    }
    retime(next, u, rate, over);
    const log = this.log;
    if (this.keeps && was.anchorNow < u) log.push(next);
    else log[log.length - 1] = next;
    let drop = 0;
    while (drop + 1 < log.length && (log[drop + 1] as Clock).anchorElapsed <= reach) drop++;
    if (drop > 0) log.splice(0, drop);
  }

  /** A copy holding the clocks that took effect before host time `u`, for a read back to then. */
  until(u: number): Pace {
    const log = this.log;
    let n = 1;
    while (n < log.length && (log[n] as Clock).anchorNow < u) n++;
    return new Pace(this.keeps, log.slice(0, n));
  }
}
