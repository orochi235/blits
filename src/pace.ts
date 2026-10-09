import { type Clock, elapsedWith, rateWith, retime, timeWith } from './clock.js';

/** A clock in a pace's log, with the frame that set it, which a history store's cut goes by. */
export interface Paced extends Clock {
  seq: number;
}

/**
 * A mix's own rate, as a clock: mix time as a function of host time, which here means the host's
 * timestamp less what `rebase` took out. Each entry is the clock from the host time it took effect,
 * oldest first, and the last is in force; under `history` the entries a read back may reach are
 * kept, and without it only the last. Entries are never changed once logged, so a copy of the log
 * stays as it was.
 */
export class Pace {
  private log: Paced[];

  constructor(
    private readonly keeps: boolean,
    log: Paced[] = [
      { anchorNow: 0, anchorElapsed: 0, rate: 1, ramp: null, seq: Number.NEGATIVE_INFINITY },
    ],
  ) {
    this.log = log;
  }

  private get clock(): Paced {
    return this.log[this.log.length - 1] as Paced;
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
    while (i > 0 && (log[i] as Paced).anchorNow > u) i--;
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
    while (i + 1 < log.length && t > (log[i + 1] as Paced).anchorElapsed) i++;
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
   * Sets the rate from host time `u`, in frame `seq`, at once or over `over` host ms, the way a
   * handle sets a voice's. Under history, lets go of the entries a read no longer reaches: those
   * over before mix time `reach`.
   */
  change(u: number, rate: number, over: number, reach: number, seq: number): void {
    const was = this.clock;
    const next = { ...was, seq };
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
    this.shed(reach);
  }

  /** Lets go of the clocks over before mix time `reach`, and answers them. */
  shed(reach: number): Paced[] {
    const log = this.log;
    let drop = 0;
    while (drop + 1 < log.length && (log[drop + 1] as Paced).anchorElapsed <= reach) drop++;
    return drop > 0 ? log.splice(0, drop) : [];
  }

  /** Puts back clocks a history store kept, ahead of the oldest still held. */
  unshed(back: readonly Paced[]): void {
    const first = (this.log[0] as Paced).anchorNow;
    const older = back.filter((c) => c.anchorNow < first).sort((a, b) => a.anchorNow - b.anchorNow);
    if (older.length > 0) this.log = [...older, ...this.log];
  }

  /** Lets go of the clocks set after host time `u`, for a seek back to then. */
  cut(u: number): void {
    const log = this.log;
    let n = 1;
    while (n < log.length && (log[n] as Paced).anchorNow <= u) n++;
    log.length = n;
  }

  /** A copy holding the clocks that took effect before host time `u`, for a read back to then. */
  until(u: number): Pace {
    const log = this.log;
    let n = 1;
    while (n < log.length && (log[n] as Paced).anchorNow < u) n++;
    return new Pace(this.keeps, log.slice(0, n));
  }
}
