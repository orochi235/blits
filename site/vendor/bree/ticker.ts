/** A frame clock any number of animations share, all called from one animation frame callback. */
export interface Ticker {
  /** Calls `fn` on every tick from now on; the function returned stops it. */
  add(fn: (now: number) => void): () => void;
  /** How many callbacks it is calling. */
  readonly size: number;
}

/** How early a frame may come and still count as the next tick, ms, so display jitter doesn't skip one. */
const SLACK_MS = 5;

/**
 * A ticker on `requestAnimationFrame`, running only while something is added. With `fps`, it ticks
 * on the first frame at least that interval after the last, so 30 on a 60 Hz display is every
 * other frame.
 */
export function createTicker(opts: { fps?: number } = {}): Ticker {
  const fns = new Set<(now: number) => void>();
  const every = opts.fps ? 1000 / opts.fps - SLACK_MS : 0;
  let raf = 0;
  let last = Number.NEGATIVE_INFINITY;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (now - last < every) return;
    last = now;
    // One animation that throws must not stop the rest drawing.
    for (const fn of fns) {
      try {
        fn(now);
      } catch (e) {
        console.error(e);
      }
    }
  };
  return {
    add(fn) {
      const wrapped = (now: number) => fn(now);
      fns.add(wrapped);
      if (fns.size === 1) raf = requestAnimationFrame(tick);
      return () => {
        if (!fns.delete(wrapped) || fns.size > 0) return;
        cancelAnimationFrame(raf);
        last = Number.NEGATIVE_INFINITY;
      };
    },
    get size() {
      return fns.size;
    },
  };
}
