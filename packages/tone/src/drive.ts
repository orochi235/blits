import type { BookedHit, Kit, Marked, Mix } from '@msb235/blits';
import { immediate, type ToneAudioNode } from 'tone';
import { type Bind, type Sound, wire } from './sound.js';

/** What the driver schedules on: a Tone `Param` or `Signal`, or a native `AudioParam`. */
export interface Target {
  cancelAndHoldAtTime(time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}

/** A target per channel the subject drives; only channels holding one number take one. */
export type Targets<O> = {
  [K in keyof O as NonNullable<O[K]> extends number ? K : never]?: Target;
};

export interface DriveOptions<E = unknown, I = unknown, O = unknown> {
  /** The mix's kit, which `wire` reads to know which of a node's parameters to drive and how. */
  kit?: Kit<O>;
  /**
   * How far ahead curves are written and items booked, ms. It has to outlast the longest gap
   * between two writes. Default 150.
   */
  ahead?: number;
  /** The spacing of a curve's points on the audio clock, ms. Default 5. */
  grid?: number;
  /** As `BookOptions.late`: how late an item first seen may be and still play, ms. Default 50. */
  late?: number;
  /** The audio clock, in seconds. Default Tone's `immediate`. */
  clock?: () => number;
  /**
   * Called once for each mark and hit within `ahead`, as `BookOptions.take` is, with `time` in
   * seconds on the audio clock. Return a `cancel` to hear that the item moved or went away; it is
   * then played again at its new time. Without `take` no mark or hit is played.
   */
  take?: (
    item: Marked | BookedHit<E, I>,
    time: number,
    lateBy: number,
  ) => { cancel(): void } | undefined;
  /** Play only the voices, and announced marks, carrying this tag. */
  tag?: string;
  /** Play only this score's voices and marks. */
  score?: string;
}

export interface Driver<I, O> {
  /**
   * Wires a Tone node to the mix as a `Sound`, its own subject: each of its parameters named by a
   * channel in the kit is driven, moved from the value it had when wired.
   */
  wire<N extends ToneAudioNode>(node: N): Sound<N, I, O>;
  attach(subject: I, targets: Targets<O>): void;
  /** Unbinds the subject; its targets hold the value they had reached. */
  detach(subject: I): void;
  /** Writes every attached subject's curves from the last sync to `ahead`. Call it after `mix.sync`. */
  write(): void;
  /**
   * Detaches every subject and cancels what `take` has booked ahead. The driver is done: `write`
   * does nothing after it.
   */
  cancel(): void;
}

/** A channel, its target, and how a value moves the target; `null` writes the value as it is. */
export type Driven<O> = [keyof O, Target, ((value: number) => number) | null];

interface Bound<O> {
  targets: Driven<O>[];
  pose: O;
}

function ms(name: string, value: number, least: number): number {
  if (!(value >= least && value < Number.POSITIVE_INFINITY))
    throw new RangeError(`blits-tone: ${name} is a finite number of ms, not ${value}`);
  return value;
}

export function drive<I, O, E = unknown>(
  mix: Mix<I, O>,
  opts: DriveOptions<E, I, O> = {},
): Driver<I, O> {
  const ahead = ms('ahead', opts.ahead ?? 150, 0);
  const grid = ms('grid', opts.grid ?? 5, Number.MIN_VALUE);
  const late = ms('late', opts.late ?? 50, 0);
  const seconds = opts.clock ?? immediate;
  const bound = new Map<I, Bound<O>>();
  let done = false;

  // The booker reads the clock once a sync; `write` takes that reading and the booker's own
  // mapping of host time onto it, so curves and booked items land on one.
  let reading = Number.NaN;
  const clock = (): number => {
    reading = seconds() * 1000;
    return reading;
  };

  const take = opts.take;
  const booker = mix.book<E>({
    clock,
    ahead,
    late,
    tag: opts.tag,
    score: opts.score,
    take: (item, when, lateBy) => take?.(item, when / 1000, lateBy),
  });

  const hold = (b: Bound<O>, time: number): void => {
    for (const [, target] of b.targets) target.cancelAndHoldAtTime(time);
  };

  const host: Bind<I, O> = {
    mix,
    kit: opts.kit,
    seconds,
    bind: (subject, targets) => {
      if (bound.has(subject)) throw new Error('blits-tone: that subject is attached already');
      bound.set(subject, { targets, pose: {} as O });
    },
    unbind: (subject) => bound.delete(subject),
  };

  return {
    wire: (node) => wire(host, node),

    attach(subject, targets) {
      if (bound.has(subject)) throw new Error('blits-tone: that subject is attached already');
      bound.set(subject, {
        targets: (Object.entries(targets) as [keyof O, Target][]).map(([k, t]) => [k, t, null]),
        pose: {} as O,
      });
    },

    detach(subject) {
      const b = bound.get(subject);
      if (b === undefined) return;
      bound.delete(subject);
      hold(b, seconds());
    },

    write() {
      const now = mix.now;
      if (done || Number.isNaN(now) || bound.size === 0) return;
      const read = Number.isNaN(reading) ? seconds() * 1000 : reading;
      reading = Number.NaN;
      const est = booker.at(mix.timestamp);

      // Audio ms: the estimate may trail the clock, and nothing is scheduled behind the clock.
      const from = Math.max(est, read);
      const to = Math.max(from, est + ahead);
      for (const b of bound.values()) hold(b, from / 1000);

      // Mix time runs `rate` ms to the audio clock's one, so a paused mix has one point to write.
      const rate = mix.rate;
      const points = rate > 0 ? Math.ceil((to - from) / grid - 1e-9) : 0;
      for (let i = 0; i <= points; i++) {
        const at = Math.min(from + i * grid, to);
        const projection = mix.project(now + (at - est) * rate);
        for (const [subject, b] of bound) {
          projection.probe(subject, b.pose);
          for (const [channel, target, move] of b.targets) {
            const value = b.pose[channel];
            if (typeof value === 'number' && Number.isFinite(value))
              target.linearRampToValueAtTime(move === null ? value : move(value), at / 1000);
          }
        }
      }
    },

    cancel() {
      done = true;
      booker.cancel();
      const time = seconds();
      for (const b of bound.values()) hold(b, time);
      bound.clear();
    },
  };
}
