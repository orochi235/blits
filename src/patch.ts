import type { Easing, Keyframe, Patch, Setting } from './types.js';

export interface PatchOptions<I, O, S> {
  /** The channels this patch contributes to. Every key `at` sets, and no others. */
  writes: readonly (keyof O)[];
  state?(subject: I): S;
  step?(state: S, dt: number, subject: I, setting: Setting<S>): void;
}

/** The procedural form. Flicker, roving, a hash walk, a starter strike. */
export function patch<I, O, S = void>(
  period: number,
  at: (phase: number, subject: I, setting: Setting<S>) => Partial<O>,
  opts: PatchOptions<I, O, S>,
): Patch<I, O, S> {
  return {
    form: 'fn',
    period,
    writes: opts.writes,
    at,
    state: opts.state,
    step: opts.step,
  };
}

export interface KeysOptions<O> {
  /** The curve every segment takes unless a stop or `easeBy` overrides it. */
  ease?: Easing;
  /** A curve for one channel, where it differs from the rest. */
  easeBy?: (channel: keyof O) => Easing | undefined;
  /** Milliseconds one channel waits before it starts moving, within the period. */
  delayBy?: (channel: keyof O) => number;
  /** How one channel interpolates, where its values are not numbers or number arrays. */
  lerpBy?: (channel: keyof O) => ((a: never, b: never, u: number) => unknown) | undefined;
}

const options = new WeakMap<Patch<never, never, never>, KeysOptions<unknown>>();

/** The options a `keys` patch was built with, for an engine reading its stops rather than calling it. */
export function keysOptionsOf<I, O, S>(p: Patch<I, O, S>): KeysOptions<O> | undefined {
  return options.get(p as unknown as Patch<never, never, never>) as KeysOptions<O> | undefined;
}

const linear = (a: number, b: number, u: number) => a + (b - a) * u;

function interpolate(a: unknown, b: unknown, u: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return linear(a, b, u);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = new Array<unknown>(a.length);
    for (let i = 0; i < a.length; i++) out[i] = interpolate(a[i], b[i], u);
    return out;
  }
  return u < 0.5 ? a : b;
}

/**
 * Reads one channel of a stop list at a phase. Stops that do not carry the channel are skipped, so
 * a channel may be keyed at its own resolution. `base` stands in for the value at phase 0, which is
 * how `from: 'current'` starts a voice wherever the subject already is.
 */
function readChannel<O>(
  stops: readonly Keyframe<O>[],
  channel: keyof O,
  phase: number,
  opts: KeysOptions<O>,
  base?: O[keyof O],
): O[keyof O] | undefined {
  const held: { at: number; value: O[keyof O]; ease?: Easing }[] = [];
  if (base !== undefined) held.push({ at: 0, value: base });
  for (const stop of stops) {
    const value = stop.delta[channel];
    if (value === undefined) continue;
    if (base !== undefined && stop.at === 0) continue;
    held.push({ at: stop.at, value: value as O[keyof O], ease: stop.ease });
  }
  if (held.length === 0) return undefined;
  held.sort((x, y) => x.at - y.at);

  const first = held[0] as { at: number; value: O[keyof O]; ease?: Easing };
  const lastHeld = held[held.length - 1] as { at: number; value: O[keyof O]; ease?: Easing };
  if (phase <= first.at) return first.value;
  if (phase >= lastHeld.at) return lastHeld.value;

  for (let i = 0; i < held.length - 1; i++) {
    const a = held[i] as { at: number; value: O[keyof O]; ease?: Easing };
    const b = held[i + 1] as { at: number; value: O[keyof O]; ease?: Easing };
    if (phase < a.at || phase > b.at) continue;
    const span = b.at - a.at;
    const u = span === 0 ? 1 : (phase - a.at) / span;
    const ease = b.ease ?? opts.easeBy?.(channel) ?? opts.ease;
    const eased = ease ? ease(u) : u;
    const own = opts.lerpBy?.(channel);
    return (
      own ? own(a.value as never, b.value as never, eased) : interpolate(a.value, b.value, eased)
    ) as O[keyof O];
  }
  return lastHeld.value;
}

/** Evaluates a stop list into a delta. Shared by the patch's own `at` and by `from: 'current'`. */
export function evalKeys<O>(
  stops: readonly Keyframe<O>[],
  writes: readonly (keyof O)[],
  phase: number,
  period: number,
  opts: KeysOptions<O>,
  base?: Partial<O>,
): Partial<O> {
  const out: Partial<O> = {};
  for (const channel of writes) {
    const delay = opts.delayBy?.(channel) ?? 0;
    const shifted =
      delay === 0 || period === 0 ? phase : Math.max(0, (phase * period - delay) / period);
    const value = readChannel(stops, channel, shifted, opts, base?.[channel]);
    if (value !== undefined) out[channel] = value;
  }
  return out;
}

/** The declarative form. klieg's transition sugar and wod's keyframes. */
export function keys<I, O>(
  period: number,
  stops: readonly Keyframe<O>[],
  opts: KeysOptions<O> = {},
): Patch<I, O, void> {
  const writes = [...new Set(stops.flatMap((s) => Object.keys(s.delta) as (keyof O)[]))];
  const built: Patch<I, O, void> = {
    form: 'keys',
    period,
    writes,
    keys: stops,
    at: (phase) => evalKeys(stops, writes, phase, period, opts),
  };
  options.set(built as unknown as Patch<never, never, never>, opts as KeysOptions<unknown>);
  return built;
}
