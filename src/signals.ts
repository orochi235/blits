import type { Setting, Signal } from './types.js';

const inputOf = (signals: readonly { readonly input?: boolean }[]): boolean =>
  signals.some((s) => s.input);

const marked = <I, H>(
  read: (subject: I, setting: Setting<void, H>) => number,
  input: boolean,
): Signal<I, H> => (input ? Object.assign(read, { input: true }) : read) as Signal<I, H>;

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
  }, inputOf(signals));
}

/**
 * A signal the host writes. klieg's `level`.
 *
 * @category signal
 */
export function level<I, H = unknown>(initial = 0): Signal<I, H> & { set(v: number): void } {
  let value = initial;
  return Object.assign(() => value, {
    input: true,
    set(v: number) {
      value = v;
    },
  }) as Signal<I, H> & { set(v: number): void };
}

interface Slewed {
  value: number;
  /** The timestamp this value was taken at; NaN until first sight. */
  seen: number;
}

/** Where a follower starts for a subject: on its input, or at `from`, seen now so the next frame moves. */
const firstSight = (target: number, from: number | undefined, now: number): Slewed =>
  from === undefined ? { value: target, seen: Number.NaN } : { value: from, seen: now };

/**
 * The package's one decay primitive: follows its input at a rate limit, no faster than `riseMs` per
 * unit climbing or `fallMs` draining. The mix keeps its state per voice and subject, so two voices
 * handed the same slew each follow on their own. A subject starts on its input, or at `from`.
 *
 * @category signal
 */
export function slew<I, H = unknown>(
  of: Signal<I, H>,
  { riseMs = 0, fallMs = 0, from }: { riseMs?: number; fallMs?: number; from?: number },
): Signal<I, H> {
  const read = (subject: I, setting: Setting<void, H>): number => {
    const target = of(subject, setting);
    const held = setting.keep<Slewed>(read, () => firstSight(target, from, setting.timestamp));
    if (setting.timestamp === held.seen) return held.value;
    let next = target;
    if (!Number.isNaN(held.seen) && Number.isFinite(setting.dt)) {
      const gap = target - held.value;
      const ms = gap > 0 ? riseMs : fallMs;
      if (ms > 0) {
        const step = (setting.timestamp - held.seen) / ms;
        next = gap > 0 ? Math.min(target, held.value + step) : Math.max(target, held.value - step);
      }
    }
    held.value = next;
    held.seen = setting.timestamp;
    return next;
  };
  return marked(read, inputOf([of]));
}

/**
 * The exponential counterpart to `slew`: closes the same fraction of the distance to its input in
 * every equal stretch of time, `1 − exp(−gap / ms)`, so it reads the same however the frames that
 * sample it are spaced while the input holds still. `riseMs` and `fallMs` are time constants: after
 * one, 63% of the way is covered. 0 follows at once. Within `floor` of its input it lands on it, so a
 * subject can reach rest; pass 0 to keep the curve exact. The mix keeps its state per voice and subject.
 * A subject starts on its input, or at `from`.
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
    const held = setting.keep<Slewed>(read, () => firstSight(target, from, setting.timestamp));
    if (setting.timestamp === held.seen) return held.value;
    let next = target;
    if (!Number.isNaN(held.seen) && Number.isFinite(setting.dt)) {
      const ms = target > held.value ? riseMs : fallMs;
      if (ms > 0) {
        const gap = setting.timestamp - held.seen;
        next = held.value + (target - held.value) * (1 - Math.exp(-gap / ms));
        if (Math.abs(target - next) <= floor) next = target;
      }
    }
    held.value = next;
    held.seen = setting.timestamp;
    return next;
  };
  return marked(read, inputOf([of]));
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
  return marked(read, inputOf([of]));
}
