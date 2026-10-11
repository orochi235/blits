// The rule `mix.book` keeps its own offset by, so curves and booked items land on one mapping.
const RESYNC_MS = 50;
const SLEW = 0.05;

/** Where the host's clock falls on the audio clock, both in ms. */
export class Link {
  private est = Number.NaN;
  private last = Number.NaN;

  /** The audio time of host `timestamp`, given what the audio clock reads now. */
  read(timestamp: number, clock: number): number {
    const est = this.est + (timestamp - this.last);
    const residual = clock - est;
    // A first reading has no estimate, so its residual is NaN and it starts from the clock too.
    this.est = Math.abs(residual) <= RESYNC_MS ? est + residual * SLEW : clock;
    this.last = timestamp;
    return this.est;
  }
}
