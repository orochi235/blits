/**
 * The host ms a rebase or a jump holds the mix clock for under a tape: past an ulp of any host
 * time, so the frame after it has a host time of its own.
 */
export const HELD = 2 ** -10;

/** The next number above `x`. */
export function above(x: number): number {
  if (x === Number.NEGATIVE_INFINITY) return -Number.MAX_VALUE;
  const step = Math.abs(x) * Number.EPSILON;
  return x + (step > 0 ? step : Number.MIN_VALUE);
}

/** Where a recorded call was made: its mix time, its host time and the frame it was made in. */
export interface Stamp {
  at: number;
  u: number;
  seq: number;
  /** A jump the host made at the end of the tape, which a replay makes where it was made. */
  jump: boolean;
}

/** Before the first sync there is no host time; calls made then play again before any other. */
const unsynced: Stamp = {
  at: Number.NEGATIVE_INFINITY,
  u: Number.NEGATIVE_INFINITY,
  seq: Number.NEGATIVE_INFINITY,
  jump: false,
};

/**
 * Where each call on a transport's tape was made. The tape stamps a call with its host time, which
 * a seek back takes back, so a call on a new branch can share its stamp with one on the old; each
 * is told apart by the stamp of the call before it too. A replay goes by these, since a jump or a
 * drive can part host time from mix time.
 */
export class Stamps {
  private made = new Map<string, Stamp>();

  /** The stamp of the call being recorded, which the tape's clock reads. */
  get current(): number {
    return this.k;
  }
  private k = Number.NEGATIVE_INFINITY;

  /** Notes a call made at `s`, after the call stamped `prev`; `current` is its stamp until the next. */
  mint(prev: number, s: Stamp): void {
    if (Number.isNaN(s.u)) {
      this.k = Number.NEGATIVE_INFINITY;
      return;
    }
    this.k = s.u;
    this.made.set(`${prev} ${s.u}`, s);
  }

  /** Where the call stamped `k`, after one stamped `prev`, was made. */
  of(prev: number, k: number): Stamp {
    return this.made.get(`${prev} ${k}`) ?? unsynced;
  }

  /** Lets go of the calls stamped before `from`, which the tape pruned. */
  prune(from: number): void {
    for (const [key, s] of this.made) if (s.u < from) this.made.delete(key);
  }
}
