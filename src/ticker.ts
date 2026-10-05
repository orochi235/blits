/** What a ticker runs: a mix, or anything that syncs, sleeps on `inert` and wakes by `onWake`. */
export interface Ticked {
  sync(timestamp: number): void;
  readonly inert: boolean;
  onWake(fn: () => void): () => void;
}

export interface TickerOptions {
  /**
   * The most frames a second it syncs. Under animation frames it skips a frame that comes sooner
   * than that, on a grid, so a 60 Hz display capped at 30 runs every other frame. Under a timer it
   * is the timer's rate, 60 unless given.
   */
  fps?: number;
  /**
   * Where frames come from: `'frame'`, `requestAnimationFrame`, or `'timer'`, `setTimeout`. By
   * default animation frames where they exist, and a timer where they don't, as in a worker
   * without them or in Node.
   */
  grain?: 'frame' | 'timer';
  /**
   * The clock every mix is synced by. By default an animation frame's own timestamp, or
   * `performance.now()` under a timer. A worker's `performance.now()` counts from its own origin,
   * not the page's.
   */
  now?: () => number;
  /** Stands in for `requestAnimationFrame`, as in a test. */
  raf?: (callback: (timestamp: number) => void) => number;
  /** Stands in for `cancelAnimationFrame`. */
  caf?: (id: number) => void;
}

export interface Ticker {
  /** Syncs `mix` every frame from now on, and wakes the loop on its `onWake`. Returns a remove. */
  add(mix: Ticked): () => void;
  /** Calls `fn` each frame, after every mix has synced, with the frame's timestamp. Returns an unsubscribe. */
  after(fn: (timestamp: number) => void): () => void;
  /** Keeps frames coming whatever the mixes say, until the returned release is called. */
  hold(): () => void;
  /** Cancels the waiting frame; a mix waking, `hold` or `add` starts the loop again. */
  stop(): void;
  /** What the ticker's clock reads now. */
  now(): number;
}

interface Clocks {
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  performance?: { now(): number };
  queueMicrotask: (callback: () => void) => void;
}

/** Slack under the interval that still counts as due, for a display whose frames jitter. */
const SLACK = 1;

/**
 * One frame loop for any number of mixes. It runs while a mix would still change or something
 * holds it, and sleeps otherwise, until a mix wakes it. A mix or `after` callback that throws stops
 * neither the loop nor the others: its error is thrown again on a microtask.
 */
export function ticker(opts: TickerOptions = {}): Ticker {
  const g = globalThis as unknown as Clocks;
  const perfNow = () => (g.performance === undefined ? Date.now() : g.performance.now());
  const byFrame =
    opts.raf !== undefined ||
    (opts.grain !== 'timer' && typeof g.requestAnimationFrame === 'function');
  const fps = opts.fps ?? (byFrame ? undefined : 60);
  if (fps !== undefined && !(fps > 0 && fps < Number.POSITIVE_INFINITY))
    throw new RangeError(`blits: a ticker's fps is a finite number above 0, not ${fps}`);
  const interval = fps === undefined ? 0 : 1000 / fps;

  const mixes: Ticked[] = [];
  const unwakes = new Map<Ticked, () => void>();
  const fns: ((timestamp: number) => void)[] = [];
  let holds = 0;
  let pending: unknown = null;
  let last = Number.NaN;

  const now = opts.now ?? perfNow;
  const later = (err: unknown) =>
    g.queueMicrotask(() => {
      throw err;
    });

  const request = byFrame
    ? (opts.raf ??
      ((cb: (t: number) => void) =>
        (g.requestAnimationFrame as NonNullable<Clocks['requestAnimationFrame']>)(cb)))
    : (cb: (t: number) => void) =>
        g.setTimeout(
          () => cb(now()),
          Number.isNaN(last) ? 0 : Math.max(0, last + interval - now()),
        );
  const cancel = byFrame
    ? (opts.caf ?? ((id: number) => g.cancelAnimationFrame?.(id)))
    : (id: unknown) => g.clearTimeout(id);

  const schedule = () => {
    if (pending === null) pending = request(frame);
  };

  function frame(stamp: number) {
    pending = null;
    const t = opts.now === undefined ? stamp : opts.now();
    // A capped loop skips a frame that comes early, and steps a grid so its rate does not drift
    // with the display's or with a timer's rounding. A long gap, as after sleeping, starts it again.
    if (interval > 0 && !Number.isNaN(last)) {
      const gap = t - last;
      if (gap < interval - SLACK) {
        pending = request(frame);
        return;
      }
      last = gap >= 2 * interval ? t : last + interval;
    } else last = t;
    for (const mix of [...mixes])
      try {
        mix.sync(t);
      } catch (err) {
        later(err);
      }
    for (const fn of [...fns])
      try {
        fn(t);
      } catch (err) {
        later(err);
      }
    if (holds > 0 || mixes.some((mix) => !mix.inert)) schedule();
  }

  return {
    add(mix) {
      if (!unwakes.has(mix)) {
        mixes.push(mix);
        unwakes.set(mix, mix.onWake(schedule));
      }
      schedule();
      return () => {
        const unwake = unwakes.get(mix);
        if (unwake === undefined) return;
        unwake();
        unwakes.delete(mix);
        mixes.splice(mixes.indexOf(mix), 1);
      };
    },
    after(fn) {
      fns.push(fn);
      return () => {
        const i = fns.indexOf(fn);
        if (i >= 0) fns.splice(i, 1);
      };
    },
    hold() {
      holds++;
      schedule();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
      };
    },
    stop() {
      if (pending !== null) cancel(pending as number);
      pending = null;
    },
    now,
  };
}
