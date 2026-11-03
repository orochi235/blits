import type { Bend, BookedHit, Kit, Marked, Mix, NumberChannel } from '@msb235/blits';
import { immediate, Noise, Oscillator, PolySynth, Synth, type ToneAudioNode } from 'tone';
import { hold as holdAt, ramp, set } from './held.js';
import { lines } from './lines.js';
import { type Bind, type Sound, wire } from './sound.js';

/** What the driver schedules on: a Tone `Param` or `Signal`, or a native `AudioParam`. */
export interface Target {
  cancelAndHoldAtTime(time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
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
  /**
   * The spacing of a curve's points on the audio clock, ms, where the mix's shape is not known
   * exactly. Default 5.
   */
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
  /** `wire(new Tone.Synth(options))`. */
  synth(options?: ConstructorParameters<typeof Synth>[0]): Sound<Synth, I, O>;
  /** `wire(new Tone.PolySynth(options))`. */
  polySynth(options?: ConstructorParameters<typeof PolySynth>[0]): Sound<PolySynth, I, O>;
  /** `wire(new Tone.Oscillator(options))`. */
  oscillator(options?: ConstructorParameters<typeof Oscillator>[0]): Sound<Oscillator, I, O>;
  /** `wire(new Tone.Noise(options))`. */
  noise(options?: ConstructorParameters<typeof Noise>[0]): Sound<Noise, I, O>;
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
  /** Frees a wired node to be wired again once it is detached or this driver cancelled. */
  release?: () => void;
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

  /** Holds each of the subject's targets at `time`, s, and returns the latest time one held at. */
  const hold = (b: Bound<O>, time: number): number => {
    let latest = time;
    for (const [, target] of b.targets) latest = Math.max(latest, holdAt(target, time));
    return latest;
  };

  const host: Bind<I, O> = {
    mix,
    kit: opts.kit,
    seconds,
    hold: holdAt,
    bind: (subject, targets, release) => {
      if (done) throw new Error('blits-tone: that driver is cancelled');
      if (bound.has(subject)) throw new Error('blits-tone: that subject is attached already');
      bound.set(subject, { targets, release });
    },
    unbind: (subject) => bound.delete(subject),
  };

  return {
    wire: (node) => wire(host, node),
    synth: (options) => wire(host, new Synth(options)),
    polySynth: (options) => wire(host, new PolySynth(options)),
    oscillator: (options) => wire(host, new Oscillator(options)),
    noise: (options) => wire(host, new Noise(options)),

    attach(subject, targets) {
      if (bound.has(subject)) throw new Error('blits-tone: that subject is attached already');
      bound.set(subject, {
        targets: (Object.entries(targets) as [keyof O, Target][]).map(([k, t]) => [k, t, null]),
      });
    },

    detach(subject) {
      const b = bound.get(subject);
      if (b === undefined) return;
      bound.delete(subject);
      hold(b, seconds());
      b.release?.();
    },

    write() {
      const now = mix.now;
      if (done || Number.isNaN(now) || bound.size === 0) return;
      const read = Number.isNaN(reading) ? seconds() * 1000 : reading;
      reading = Number.NaN;
      const stamp = mix.timestamp;
      const est = booker.at(stamp);

      // Audio ms: the estimate may trail the clock, and nothing is scheduled behind the clock.
      let from = Math.max(est, read);
      let held = from / 1000;
      for (const b of bound.values()) held = Math.max(held, hold(b, from / 1000));
      from = held * 1000;
      const to = Math.max(from, est + ahead);

      // The mix's clock carries its rate and any ramp of it; a paused mix has one point to write.
      const start = Math.max(now, mix.time(stamp + from - est));
      const end = Math.max(start, mix.time(stamp + to - est));
      const moves = end > start;
      const trace = moves
        ? mix.trace(start, end, { grid: (grid * (end - start)) / (to - from), bends: true })
        : mix.trace(start, start);
      const raw = (t: number): number => est + mix.when(t) - stamp;
      const audio = (t: number): number => (moves ? Math.min(to, Math.max(from, raw(t))) : from);
      // Under a ramp of the rate a line in mix time is a curve on the audio clock.
      const steady =
        !moves || Math.abs(raw((start + end) / 2) - (raw(start) + raw(end)) / 2) < 1e-6;
      for (const [subject, b] of bound)
        for (const [channel, target, move] of b.targets) {
          const run = trace.of(subject, channel as NumberChannel<O>);
          const bends = run.bends ?? [];
          let next = 0;
          for (let i = 0; i < run.at.length; i++) {
            const value = run.value[i] as number;
            if (!Number.isFinite(value)) continue;
            const t = run.at[i] as number;
            const at = audio(t);
            const t0 = run.at[i - 1] as number;
            // Two points at one time are a jump: the line arrives at the first, then it steps.
            if (i > 0 && t === t0) {
              set(target, move === null ? value : move(value), at / 1000);
              continue;
            }
            while (next < bends.length && (bends[next] as Bend).index < i - 1) next++;
            const bend = bends[next]?.index === i - 1 ? bends[next] : undefined;
            const v0 = run.value[i - 1] as number;
            if (i > 0 && (bend !== undefined || !steady) && Number.isFinite(v0)) {
              const a0 = audio(t0);
              const along = (a: number): number => {
                const m = steady
                  ? t0 + ((t - t0) * (a - a0)) / (at - a0)
                  : mix.time(stamp + a - est);
                const u = Math.min(1, Math.max(0, (m - t0) / (t - t0)));
                return v0 + (value - v0) * u + (bend === undefined ? 0 : bend.off(u));
              };
              const size =
                Math.abs(value - v0) +
                (bend === undefined
                  ? 0
                  : Math.abs(bend.off(0.25)) + Math.abs(bend.off(0.5)) + Math.abs(bend.off(0.75)));
              lines(along, a0, v0, at, value, size, (v, a) =>
                ramp(target, move === null ? v : move(v), a / 1000),
              );
            }
            ramp(target, move === null ? value : move(value), at / 1000);
          }
        }
    },

    cancel() {
      done = true;
      booker.cancel();
      const time = seconds();
      for (const b of bound.values()) {
        hold(b, time);
        b.release?.();
      }
      bound.clear();
    },
  };
}
