import type { BookedHit, Booker, Marked, Mix } from '@msb235/blits';
import { immediate } from 'tone';
import { Link } from './link.js';

/** What the driver schedules on: a Tone `Param` or `Signal`, or a native `AudioParam`. */
export interface Target {
  cancelAndHoldAtTime(time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}

/** A target per channel the subject drives; only channels holding one number take one. */
export type Targets<O> = {
  [K in keyof O as NonNullable<O[K]> extends number ? K : never]?: Target;
};

export interface DriveOptions<E = unknown> {
  /**
   * How far ahead curves are written and items booked, ms. It has to outlast the longest gap
   * between two writes. Default 150.
   */
  ahead?: number;
  /** The spacing of a curve's points on the audio clock, ms. Default 5. */
  step?: number;
  /** As `BookOptions.late`: how late an item first seen may be and still play, ms. Default 50. */
  late?: number;
  /** The audio clock, in seconds. Default Tone's `immediate`. */
  clock?: () => number;
  /**
   * Called once for each mark and hit within `ahead`, as `BookOptions.take` is, with `time` in
   * seconds on the audio clock. Return a function to hear that the item moved or went away; it is
   * then played again at its new time. Without `play` the driver books nothing.
   */
  play?: (item: Marked | BookedHit<E>, time: number, lateBy: number) => (() => void) | undefined;
  /** Play only the voices, and announced marks, carrying this tag. */
  tag?: string;
  /** Play only this score's voices and marks. */
  score?: string;
}

export interface Driver<I, O> {
  attach(subject: I, targets: Targets<O>): void;
  /** Unbinds the subject; its targets hold the value they had reached. */
  detach(subject: I): void;
  /** Writes every attached subject's curves from now to `ahead`, after `mix.sync(timestamp)`. */
  write(timestamp: number): void;
  /** Detaches every subject and stops what `play` has booked ahead. */
  stop(): void;
}

interface Bound<O> {
  targets: [keyof O, Target][];
  pose: O;
}

function ms(name: string, value: number, least: number): number {
  if (!(value >= least && value < Number.POSITIVE_INFINITY))
    throw new RangeError(`blits-tone: ${name} is a finite number of ms, not ${value}`);
  return value;
}

export function drive<I, O, E = unknown>(mix: Mix<I, O>, opts: DriveOptions<E> = {}): Driver<I, O> {
  const ahead = ms('ahead', opts.ahead ?? 150, 0);
  const step = ms('step', opts.step ?? 5, Number.MIN_VALUE);
  const late = ms('late', opts.late ?? 50, 0);
  const seconds = opts.clock ?? immediate;
  const bound = new Map<I, Bound<O>>();
  const link = new Link();

  // The booker reads the clock once a sync; `write` takes that reading, so both map by one.
  let reading = Number.NaN;
  const clock = (): number => {
    reading = seconds() * 1000;
    return reading;
  };

  let booker: Booker | undefined;
  const play = opts.play;
  if (play !== undefined)
    booker = mix.book<E>({
      clock,
      ahead,
      late,
      tag: opts.tag,
      score: opts.score,
      take(item, when, lateBy) {
        const stop = play(item, when / 1000, lateBy);
        return stop === undefined ? undefined : { stop };
      },
    });

  const hold = (b: Bound<O>, time: number): void => {
    for (const [, target] of b.targets) target.cancelAndHoldAtTime(time);
  };

  return {
    attach(subject, targets) {
      if (bound.has(subject)) throw new Error('blits-tone: that subject is attached already');
      bound.set(subject, {
        targets: Object.entries(targets) as [keyof O, Target][],
        pose: {} as O,
      });
    },

    detach(subject) {
      const b = bound.get(subject);
      if (b === undefined) return;
      bound.delete(subject);
      hold(b, seconds());
    },

    write(timestamp) {
      const now = mix.now;
      if (Number.isNaN(now)) return;
      const read = Number.isNaN(reading) ? clock() : reading;
      reading = Number.NaN;
      const est = link.read(timestamp, read);
      if (bound.size === 0) return;

      // Audio ms: the estimate may trail the clock, and nothing is scheduled behind the clock.
      const from = Math.max(est, read);
      const to = Math.max(from, est + ahead);
      for (const b of bound.values()) hold(b, from / 1000);

      // Mix time runs `rate` ms to the audio clock's one, so a paused mix has one point to write.
      const rate = mix.rate;
      const points = rate > 0 ? Math.ceil((to - from) / step - 1e-9) : 0;
      for (let i = 0; i <= points; i++) {
        const at = Math.min(from + i * step, to);
        const projection = mix.project(now + (at - est) * rate);
        for (const [subject, b] of bound) {
          projection.probe(subject, b.pose);
          for (const [channel, target] of b.targets) {
            const value = b.pose[channel];
            if (typeof value === 'number' && Number.isFinite(value))
              target.linearRampToValueAtTime(value, at / 1000);
          }
        }
      }
    },

    stop() {
      booker?.stop();
      const time = seconds();
      for (const b of bound.values()) hold(b, time);
      bound.clear();
    },
  };
}
