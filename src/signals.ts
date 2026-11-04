import { reading } from './reading.js';
import type { Band, Setting, Signal } from './types.js';

/** Input signals whose every change bumps `reading.inputs`: `input`'s, and those built only on them. */
const told = new WeakSet<object>();

/** Whether a change to an input signal reaches `reading.inputs`, so a lane fill can see it. */
export const heard = (signal: object): boolean => told.has(signal);

/** Signals that read the same for every subject: only `level`'s, since a function's `length` can't say. */
const alike = new WeakSet<object>();

/** Whether a signal reads the same for every subject, so one read serves them all. */
export const subjectFree = (signal: object): boolean => alike.has(signal);

const inputOf = (signals: readonly { readonly input?: boolean }[]): boolean =>
  signals.some((s) => s.input);

const marked = <I, H>(
  read: (subject: I, setting: Setting<void, H>) => number,
  of: readonly Signal<I, H>[],
): Signal<I, H> => {
  if (!inputOf(of)) return read as Signal<I, H>;
  if (of.every((s) => !s.input || told.has(s))) told.add(read);
  return Object.assign(read, { input: true }) as Signal<I, H>;
};

/**
 * The largest of several signals, for each subject.
 *
 * @category signal
 */
export function peak<I, H = unknown>(...signals: readonly Signal<I, H>[]): Signal<I, H> {
  return marked<I, H>((subject, setting) => {
    let out = 0;
    for (const s of signals) {
      const v = s(subject, setting);
      if (v > out) out = v;
    }
    return out;
  }, signals);
}

/** A blend member's share of its signal's read `k`: the members' stops sit evenly along 0..1. */
export function shareOf(k: number, i: number, stops: number): number {
  const d = stops === 0 ? 0 : Math.abs(k * stops - i);
  return d >= 1 ? 0 : 1 - d;
}

/**
 * The weight `mix.blend` gives member `i` of `n` when `by` reads a given value. The members sit at
 * evenly spaced stops from 0 to 1; a member weighs 1 when `by` is at its stop, falling to 0 at the
 * stops either side. With two members, `share(by, 0, 2)` is `1 - by` and `share(by, 1, 2)` is `by`.
 * Use it to weight voices cued on their own as if they were members of one blend.
 *
 * @category signal
 */
export function share<I, H = unknown>(by: Signal<I, H>, i: number, n: number): Signal<I, H> {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(i) || i < 0 || i >= n)
    throw new Error(`blits: share wants a member 0 to ${n - 1}, not ${i}`);
  return marked<I, H>((subject, setting) => shareOf(by(subject, setting), i, n - 1), [by]);
}

const touch = (): void => {
  reading.inputs++;
};

/**
 * The signal `input` returns, with `touch` to report a change.
 *
 * @category signal
 */
export interface Input<I, H = unknown> extends Signal<I, H> {
  /** Reports a change to what the signal reads. */
  touch(): void;
}

/**
 * Marks `read` as a signal driven from outside the clock. A host's own signal has to be one for
 * `assess` and a history's {@link HistoryOptions.inputs | `inputs`} to treat it as one. Two uses:
 *
 * `input(read)` is an input of the host's own: a pointer, a volume, a value in a store. The host
 * calls {@link Input.touch | `touch()`} after each change to what `read` reads, and a voice weighted by the signal, or by
 * `peak`, `slew`, `lag` or `gate` over it, keeps its lane. A change nobody reports shows once the
 * mix's clock next moves.
 *
 * `input(read, of)` is a signal built on others, as a wrapper that clamps one is: `of` lists every
 * signal `read` calls, and the result is an input where any of them is, and reports its changes
 * where they all do.
 *
 * @category signal
 */
export function input<I, H = unknown>(
  read: (subject: I, setting: Setting<void, H>) => number,
  of?: readonly Signal<I, H>[],
): Input<I, H> {
  if (of !== undefined) return Object.assign(marked(read, of), { touch });
  told.add(read);
  return Object.assign(read, { input: true, touch });
}

/**
 * The signal `level` returns, with `set` to write it.
 *
 * @category signal
 */
export interface Level<I, H = unknown> extends Signal<I, H> {
  /** Writes the level, reporting the change; writing the value it holds already does nothing. */
  set(v: number): void;
}

/**
 * A signal holding one number your code sets, such as a slider's value or a toggle as 0 or 1. Call
 * {@link Level.set | `set`} to change it; every voice it weights follows.
 *
 * @category signal
 */
export function level<I, H = unknown>(initial = 0): Level<I, H> {
  let value = initial;
  const read = input<I, H>(() => value);
  alike.add(read);
  return Object.assign(read, {
    set(v: number) {
      if (Object.is(v, value)) return;
      value = v;
      touch();
    },
  });
}

interface Slewed {
  value: number;
  /** The timestamp this value was taken at; NaN until first sight. */
  seen: number;
}

/**
 * Where a follower starts for a subject: on its input, or at `from`, seen now so the next frame
 * moves. Under reduced motion it starts on its input, since every later frame would snap there.
 */
const firstSight = (
  target: number,
  from: number | undefined,
  setting: Setting<void, unknown>,
): Slewed =>
  from === undefined || !Number.isFinite(setting.dt)
    ? { value: target, seen: Number.NaN }
    : { value: from, seen: setting.timestamp };

/**
 * What `slew` takes.
 *
 * @category signal
 */
export interface SlewOptions {
  /** Ms per unit climbing; 0 follows at once. Default 0. */
  riseMs?: number;
  /** Ms per unit draining; 0 follows at once. Default 0. */
  fallMs?: number;
  /** Where a subject starts, unless `dt` is infinite. Default: on its input. */
  from?: number;
}

/**
 * A signal that follows another at a limited speed, in straight lines. No faster than {@link SlewOptions.riseMs | `riseMs`}
 * per unit climbing or {@link SlewOptions.fallMs | `fallMs`} draining. The mix keeps its state per voice and subject, so two
 * voices handed the same slew each follow on their own. A subject starts on its input, or at {@link SlewOptions.from | `from`}
 * unless {@link Setting.dt | `dt`} is infinite.
 *
 * @category signal
 */
export function slew<I, H = unknown>(
  of: Signal<I, H>,
  { riseMs = 0, fallMs = 0, from }: SlewOptions,
): Signal<I, H> {
  const read = (subject: I, setting: Setting<void, H>): number => {
    const target = of(subject, setting);
    const held = setting.keep<Slewed>(read, () => firstSight(target, from, setting));
    if (setting.timestamp === held.seen) return held.value;
    let next = target;
    if (!Number.isNaN(held.seen) && Number.isFinite(setting.dt)) {
      const gap = target - held.value;
      const ms = gap > 0 ? riseMs : fallMs;
      if (ms > 0) {
        // No longer than `dt`, which `maxDt` caps, as every step is.
        const step = Math.min(setting.timestamp - held.seen, setting.dt) / ms;
        next = gap > 0 ? Math.min(target, held.value + step) : Math.max(target, held.value - step);
      }
    }
    held.value = next;
    held.seen = setting.timestamp;
    return next;
  };
  return marked(read, [of]);
}

/**
 * What `lag` takes.
 *
 * @category signal
 */
export interface LagOptions {
  /** The time constant climbing, ms; 0 follows at once. Default 0. */
  riseMs?: number;
  /** The time constant draining, ms; 0 follows at once. Default 0. */
  fallMs?: number;
  /** Within this of its input it lands on it; 0 keeps the curve exact. Default 1e-6. */
  floor?: number;
  /** Where a subject starts, unless `dt` is infinite. Default: on its input. */
  from?: number;
}

/**
 * Closes the same fraction of the distance to its input in every equal stretch of time. The
 * exponential counterpart to `slew`: the fraction is `1 − exp(−gap / ms)`, so it reads the same
 * however the frames that sample it are spaced while the input holds still. {@link LagOptions.riseMs | `riseMs`} and {@link LagOptions.fallMs | `fallMs`}
 * are time constants: after one, 63% of the way is covered. 0 follows at once. Within {@link LagOptions.floor | `floor`} of
 * its input it lands on it, so a subject can reach rest; pass 0 to keep the curve exact. The mix
 * keeps its state per voice and subject. A subject starts on its input, or at {@link LagOptions.from | `from`} unless {@link Setting.dt | `dt`} is
 * infinite.
 *
 * @category signal
 */
export function lag<I, H = unknown>(
  of: Signal<I, H>,
  { riseMs = 0, fallMs = 0, floor = 1e-6, from }: LagOptions,
): Signal<I, H> {
  const read = (subject: I, setting: Setting<void, H>): number => {
    const target = of(subject, setting);
    const held = setting.keep<Slewed>(read, () => firstSight(target, from, setting));
    if (setting.timestamp === held.seen) return held.value;
    let next = target;
    if (!Number.isNaN(held.seen) && Number.isFinite(setting.dt)) {
      const ms = target > held.value ? riseMs : fallMs;
      if (ms > 0) {
        const gap = Math.min(setting.timestamp - held.seen, setting.dt);
        next = held.value + (target - held.value) * (1 - Math.exp(-gap / ms));
        if (Math.abs(target - next) <= floor) next = target;
      }
    }
    held.value = next;
    held.seen = setting.timestamp;
    return next;
  };
  return marked(read, [of]);
}

interface Gated {
  on: boolean;
  seen: number;
}

/**
 * A signal that is 1 while its input is high and 0 while it is low, with a gap between the two
 * switching points so an input hovering near one doesn't flicker. It drops to 0 at
 * {@link Band.off | `off`}, rises to 1 at `on`, and between the two holds whatever it was.
 *
 * @category signal
 */
export function gate<I, H = unknown>(of: Signal<I, H>, band: Band | number): Signal<I, H> {
  const on = typeof band === 'number' ? band : band.on;
  const off = typeof band === 'number' ? band : band.off;
  const read = (subject: I, setting: Setting<void, H>): number => {
    const input = of(subject, setting);
    const held = setting.keep<Gated>(read, () => ({ on: input >= on, seen: Number.NaN }));
    if (setting.timestamp !== held.seen) {
      held.on = input >= on ? true : input <= off ? false : held.on;
      held.seen = setting.timestamp;
    }
    return held.on ? 1 : 0;
  };
  return marked(read, [of]);
}
