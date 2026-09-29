import type { Setting, Signal } from './types.js';

const inputOf = (signals: readonly Signal<never>[]): boolean => signals.some((s) => s.input);

const marked = <I>(read: (subject: I, setting: Setting) => number, input: boolean): Signal<I> =>
  (input ? Object.assign(read, { input: true }) : read) as Signal<I>;

/** The loudest of several signals. */
export function peak<I>(...signals: readonly Signal<I>[]): Signal<I> {
  return marked<I>((subject, setting) => {
    let out = 0;
    for (const s of signals) {
      const v = s(subject, setting);
      if (v > out) out = v;
    }
    return out;
  }, inputOf(signals));
}

/** A signal the host writes. klieg's `level`. */
export function level<I>(initial = 0): Signal<I> & { set(v: number): void } {
  let value = initial;
  return Object.assign(() => value, {
    input: true,
    set(v: number) {
      value = v;
    },
  }) as Signal<I> & { set(v: number): void };
}

interface Slewed {
  value: number;
  /** The timestamp this value was taken at; NaN until first sight. */
  seen: number;
}

/**
 * The package's one decay primitive: follows its input at a rate limit, no faster than `riseMs` per
 * unit climbing or `fallMs` draining. The mix keeps its state per voice and subject, so two voices
 * handed the same slew each follow on their own.
 */
export function slew<I>(
  of: Signal<I>,
  { riseMs = 0, fallMs = 0 }: { riseMs?: number; fallMs?: number },
): Signal<I> {
  const read = (subject: I, setting: Setting): number => {
    const target = of(subject, setting);
    const held = setting.keep<Slewed>(read, () => ({ value: target, seen: Number.NaN }));
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

interface Gated {
  on: boolean;
  seen: number;
}

/**
 * The other half of the pair: a band, not an edge. It drops at `off`, passes at `on`, and between
 * the two it holds whatever it last did, so an input resting on a threshold cannot chatter.
 */
export function gate<I>(of: Signal<I>, band: { on: number; off: number } | number): Signal<I> {
  const on = typeof band === 'number' ? band : band.on;
  const off = typeof band === 'number' ? band : band.off;
  const read = (subject: I, setting: Setting): number => {
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
