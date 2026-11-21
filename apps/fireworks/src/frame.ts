import type { Mix } from '@msb235/blits';

/** A gap between frames this long is a hidden tab coming back, and is left out of the show. */
const AWAY_MS = 250;

export interface FrameOptions {
  /** Sends one shell up. */
  launch: () => void;
  /** Whether the show keeps launching shells on its own. */
  auto: () => boolean;
}

/**
 * The show's frame: syncs the mix and launches on its clock, and returns the seconds of mix time
 * the frame played, which is how far the sparks age. A hold, a pause or a seek back plays none.
 */
export function createFrame<I, O>(m: Mix<I, O>, opts: FrameOptions): (now: number) => number {
  let last = Number.NaN;
  let next = Number.NEGATIVE_INFINITY;
  return (now) => {
    if (now - last > AWAY_MS) m.rebase();
    last = now;
    const before = m.now;
    m.sync(now);
    if (opts.auto() && m.now >= next) {
      opts.launch();
      next = m.now + 350 + Math.random() * 900;
    }
    const played = m.now - before;
    return Number.isFinite(played) ? Math.min(Math.max(played, 0), AWAY_MS) / 1000 : 0;
  };
}
