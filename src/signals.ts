import { reading } from './reading.js';
import type { Setting, Signal } from './types.js';

/** Input signals whose every change bumps `reading.inputs`: `input`'s, and those built only on them. */
const told = new WeakSet<object>();

/** Whether a change to an input signal reaches `reading.inputs`, so a lane fill can see it. */
export const heard = (signal: object): boolean => told.has(signal);

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
 * The loudest of several signals.
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

const touch = (): void => {
  reading.inputs++;
};

/**
 * Marks `read` as a signal driven from outside the clock, which a host's own signal has to be for
 * `assess` and a history's `inputs` to treat it as one. Two uses:
 *
 * `input(read)` is an input of the host's own: a pointer, a volume, a value in a store. The host
 * calls `touch()` after each change to what `read` reads, and a voice weighted by the signal, or by
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
): Signal<I, H> & { touch(): void } {
  if (of !== undefined) return Object.assign(marked(read, of), { touch });
  told.add(read);
  return Object.assign(read, { input: true, touch });
}

/**
 * A signal the host writes: `input` over one number, with `set` reporting each change. klieg's
 * `level`.
 *
 * @category signal
 */
export function level<I, H = unknown>(initial = 0): Signal<I, H> & { set(v: number): void } {
  let value = initial;
  return Object.assign(
    input<I, H>(() => value),
    {
      set(v: number) {
        if (Object.is(v, value)) return;
        value = v;
        touch();
      },
    },
  );
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
 * The package's one decay primitive: follows its input at a rate limit, no faster than `riseMs` per
 * unit climbing or `fallMs` draining. The mix keeps its state per voice and subject, so two voices
 * handed the same slew each follow on their own. A subject starts on its input, or at `from`
 * unless `dt` is infinite.
 *
 * @category signal
 */
export function slew<I, H = unknown>(
  of: Signal<I, H>,
  { riseMs = 0, fallMs = 0, from }: { riseMs?: number; fallMs?: number; from?: number },
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
 * The exponential counterpart to `slew`: closes the same fraction of the distance to its input in
 * every equal stretch of time, `1 − exp(−gap / ms)`, so it reads the same however the frames that
 * sample it are spaced while the input holds still. `riseMs` and `fallMs` are time constants: after
 * one, 63% of the way is covered. 0 follows at once. Within `floor` of its input it lands on it, so a
 * subject can reach rest; pass 0 to keep the curve exact. The mix keeps its state per voice and subject.
 * A subject starts on its input, or at `from` unless `dt` is infinite.
 *
 * @category signal
 */
export function lag<I, H = unknown>(
  of: Signal<I, H>,
  {
    riseMs = 0,
    fallMs = 0,
    floor = 1e-6,
    from,
  }: { riseMs?: number; fallMs?: number; floor?: number; from?: number },
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
 * The other half of the pair: a band, not an edge. It drops at `off`, passes at `on`, and between
 * the two it holds whatever it last did, so an input resting on a threshold cannot chatter.
 *
 * @category signal
 */
export function gate<I, H = unknown>(
  of: Signal<I, H>,
  band: { on: number; off: number } | number,
): Signal<I, H> {
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
