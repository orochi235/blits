import { Store } from './store.js';
import type { Setting, Signal } from './types.js';

/** The loudest of several signals. */
export function peak<I>(...signals: readonly Signal<I>[]): Signal<I> {
  return (subject, setting) => {
    let out = 0;
    for (const s of signals) {
      const v = s(subject, setting);
      if (v > out) out = v;
    }
    return out;
  };
}

/** A signal the host writes. klieg's `level`. */
export function level<I>(initial = 0): Signal<I> & { set(v: number): void } {
  let value = initial;
  const read = (() => value) as unknown as Signal<I> & { set(v: number): void };
  read.set = (v: number) => {
    value = v;
  };
  return read;
}

interface Slewed {
  value: number;
  seen: number;
}

/**
 * The package's one decay primitive: follows its input at a rate limit, no faster than `riseMs` per
 * unit climbing or `fallMs` draining. State belongs to the instance, so two voices handed the same
 * slew share its per-subject value.
 */
export function slew<I>(
  of: Signal<I>,
  { riseMs = 0, fallMs = 0 }: { riseMs?: number; fallMs?: number },
): Signal<I> {
  const held = new Store<I, Slewed>();
  return (subject, setting: Setting) => {
    const target = of(subject, setting);
    const prior = held.get(subject);
    if (prior === undefined) {
      held.set(subject, { value: target, seen: setting.now });
      return target;
    }
    if (setting.now === prior.seen) return prior.value;
    const dt = setting.dt;
    const gap = target - prior.value;
    let next = target;
    if (Number.isFinite(dt)) {
      const ms = gap > 0 ? riseMs : fallMs;
      if (ms > 0) {
        const step = dt / ms;
        next =
          gap > 0 ? Math.min(target, prior.value + step) : Math.max(target, prior.value - step);
      }
    }
    prior.value = next;
    prior.seen = setting.now;
    return next;
  };
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
  const held = new Store<I, Gated>();
  return (subject, setting: Setting) => {
    const input = of(subject, setting);
    const prior = held.get(subject);
    if (prior !== undefined && setting.now === prior.seen) return prior.on ? 1 : 0;
    const was = prior?.on ?? input >= on;
    const now = input >= on ? true : input <= off ? false : was;
    if (prior === undefined) held.set(subject, { on: now, seen: setting.now });
    else {
      prior.on = now;
      prior.seen = setting.now;
    }
    return now ? 1 : 0;
  };
}
