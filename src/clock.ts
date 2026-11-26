import type { Curve } from './easing.js';

/** Refuses a ramp's length that is not a finite time of 0 or more, which would poison the clock. */
export function rampTime(over: number): void {
  if (!(over >= 0 && over < Number.POSITIVE_INFINITY))
    throw new RangeError(`blits: a ramp takes a finite time of 0 or more, not ${over}`);
}

/**
 * How many passes a voice's `loop` plays: one for none or `false`, Infinity for `true`.
 *
 * @category voice
 */
export function passesOf(loop: boolean | number | undefined): number {
  const l = loop ?? false;
  return l === true ? Number.POSITIVE_INFINITY : l === false ? 1 : l;
}

/** How long a patch of `duration` ms plays over `passes` passes: endless with no duration or end. */
export const spanOf = (duration: number, passes: number): number =>
  duration > 0 && Number.isFinite(passes) ? duration * passes : Number.POSITIVE_INFINITY;

/** Whether `elapsed` voice ms is past the last of `passes` passes of a patch of `duration` ms. */
const over = (elapsed: number, duration: number, passes: number): boolean =>
  Number.isFinite(passes) && elapsed >= duration * passes;

/**
 * The pass `elapsed` voice ms falls in, of a patch of `duration` ms playing `passes` passes: the
 * last once they are done, a fraction's included. The quotient and the remainder can round to
 * different passes (`50 / 0.1` is 500, `50 % 0.1` nearly 0.1), so the pass is settled against the
 * product the phase is measured from. With `edge`, the start of a pass after the first reads as the
 * end of the one before.
 *
 * @category voice
 */
export function passAt(elapsed: number, duration: number, passes: number, edge = false): number {
  if (!(duration > 0) || duration === Number.POSITIVE_INFINITY) return 0;
  if (over(elapsed, duration, passes)) return Math.ceil(passes) - 1;
  let pass = Math.floor(elapsed / duration);
  if (pass * duration > elapsed) pass -= 1;
  else if ((pass + 1) * duration <= elapsed) pass += 1;
  return edge && pass > 0 && elapsed === pass * duration ? pass - 1 : pass;
}

/**
 * How far into its pass `elapsed` voice ms is, 0..1, as {@link passAt | `passAt`} places it: once the
 * passes are done, where the last ends, which is short of 1 for a fraction of a pass.
 *
 * @category voice
 */
export function phaseAt(elapsed: number, duration: number, passes: number, edge = false): number {
  if (!(duration > 0) || duration === Number.POSITIVE_INFINITY) return 0;
  const pass = passAt(elapsed, duration, passes, edge);
  if (over(elapsed, duration, passes)) return passes - pass;
  if (edge && (pass + 1) * duration - elapsed <= 4 * Number.EPSILON * Math.abs(elapsed)) return 1;
  const u = (elapsed - pass * duration) / duration;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/**
 * A fade in from `since` over `fadeIn` at mix time `now`, 0..1. It stands still where a fade out
 * began, or the two ramps multiply into a rise, from `stop` on, and through `stalls`, pairs of mix
 * times.
 */
export function fadeInAt(
  fadeIn: number,
  out: { at: number; over: number; rest: boolean } | null,
  ease: Curve | undefined,
  now: number,
  since: number,
  stalls: readonly number[] | null,
  stop = Number.POSITIVE_INFINITY,
): number {
  let end = out && !out.rest && out.at < now ? out.at : now;
  if (stop < end) end = stop;
  let climbed = end - since;
  if (stalls !== null)
    for (let i = 0; i < stalls.length; i += 2) {
      const a = Math.max(stalls[i] as number, since);
      const b = Math.min(stalls[i + 1] as number, end);
      if (b > a) climbed -= b - a;
    }
  const u = clampWeight(climbed / fadeIn);
  return u === 1 ? 1 : ease ? ease(u) : u;
}

/**
 * `stalls` with the pair `a`..`b` added, joined to a last pair it meets, less the leading pairs
 * that `fadeIn` or more of climbing before mix time `by` follows: no fade in `fadeInAt` reads from
 * then on still stands in them. A new array, as a logged control keeps the one it had.
 */
export function stalled(
  stalls: readonly number[] | null,
  a: number,
  b: number,
  fadeIn: number,
  by: number,
): number[] {
  const s = stalls ?? [];
  let n = s.length;
  if (n > 0 && a <= (s[n - 1] as number)) {
    a = s[n - 2] as number;
    n -= 2;
  }
  let stood = Math.max(0, Math.min(b, by) - a);
  let keep = n;
  for (let i = n - 2; i >= 0; i -= 2) {
    const end = s[i + 1] as number;
    if (by - end - stood >= fadeIn) break;
    keep = i;
    stood += Math.max(0, Math.min(end, by) - (s[i] as number));
  }
  const kept = s.slice(keep, n);
  kept.push(a, b);
  return kept;
}

/**
 * A voice's own fade this frame, 0..1: in from `since` over `fadeIn`, out along its ramp, and back
 * up the same curve where a fade out was turned around.
 */
export function envelope(
  fadeIn: number,
  out: { at: number; over: number; rest: boolean } | null,
  ease: Curve | undefined,
  reduced: boolean,
  now: number,
  since: number,
  back: { from: number; at: number; over: number } | null = null,
  stalls: readonly number[] | null = null,
): number {
  let w = 1;
  if (fadeIn > 0 && !reduced) w *= fadeInAt(fadeIn, out, ease, now, since, stalls);
  if (back && !reduced) {
    const u = clampWeight(back.from + (now - back.at) / back.over);
    if (u < 1) w *= ease ? ease(u) : u;
  }
  if (out && !out.rest) {
    if (reduced || out.over === 0) return 0;
    const u = clampWeight(1 - (now - out.at) / out.over);
    w *= ease ? ease(u) : u;
  }
  return w;
}

/** A voice's own fade at mix time `now`, its fade in counting from `since`. */
export function voiceEnvelope(
  voice: {
    readonly fade: { readonly in?: number };
    readonly out: { at: number; over: number; rest: boolean } | null;
    readonly ease: Curve | undefined;
    readonly back: { from: number; at: number; over: number } | null;
    readonly stalls: readonly number[] | null;
  },
  reduced: boolean,
  now: number,
  since: number,
): number {
  return envelope(
    voice.fade.in ?? 0,
    voice.out,
    voice.ease,
    reduced,
    now,
    since,
    voice.back,
    voice.stalls,
  );
}

/**
 * A subject's voice time `raw` once the voice's freezes apply: 0 before it starts if it freezes
 * before, else NaN, where it shows nothing; `span` once its passes end if it freezes after. A `raw`
 * of NaN is before its start: a pending voice at rate 0 whose pinned start a mix at rate 0 puts at
 * infinity reads its clock as infinity times 0.
 */
export function frozenTime(raw: number, before: boolean, after: boolean, span: number): number {
  if (!(raw >= 0)) return before ? 0 : Number.NaN;
  return after && raw > span ? span : raw;
}

/**
 * `Object.is` for two numbers, which V8 answers by boxing both where it does not inline the call: 32
 * bytes a subject in a fill's loop (bench/allocs.mjs, 2026-10-09).
 */
export function same(a: number, b: number): boolean {
  return a === b ? a !== 0 || 1 / a === 1 / b : Number.isNaN(a) && Number.isNaN(b);
}

/** A weight, or any other share, held to 0..1; -0 is held to 0, and NaN stays NaN. */
export function clampWeight(raw: number): number {
  return raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
}

/**
 * A voice's weight for one subject: its own `base`, times its fade and what the subject's own ramp
 * out of it leaves (1 without one), held to 0..1 once, after both.
 */
export function weighed(base: number, fade: number, parting: number): number {
  return clampWeight(base * (fade * parting));
}

/**
 * Whether a voice's `at` goes unasked for a subject at `weight`: nothing it returns would fold. A voice
 * fading to rest is still asked, since its delta is what says it has arrived.
 */
export function silent(
  voice: { readonly out: { readonly rest: boolean } | null },
  weight: number,
): boolean {
  return !(weight > 0) && voice.out?.rest !== true;
}

/** What sets a clock: its rate, and where it was last anchored. */
export interface Clock {
  anchorNow: number;
  anchorElapsed: number;
  rate: number;
  ramp: { from: number; to: number; over: number } | null;
}

/**
 * What a clock reads at `now`: `anchorElapsed` plus its rate integrated from `anchorNow`. Without a
 * ramp the rate is constant; with one it moves linearly from `from` to `to` over `over` ms from the
 * anchor, and holds `to` after.
 */
export function elapsedWith(c: Clock, now: number): number {
  const dt = now - c.anchorNow;
  const r = c.ramp;
  if (r === null) return c.anchorElapsed + run(c.rate, dt);
  if (dt <= 0) return c.anchorElapsed + run(r.from, dt);
  if (ended(c, now))
    return (
      c.anchorElapsed + r.from * r.over + ((r.to - r.from) * r.over) / 2 + run(r.to, dt - r.over)
    );
  return c.anchorElapsed + r.from * dt + ((r.to - r.from) * dt * dt) / (2 * r.over);
}

/** How far `rate` carries a clock over `dt`; a clock at rest goes nowhere, however long the gap. */
function run(rate: number, dt: number): number {
  return rate === 0 ? 0 : rate * dt;
}

/**
 * Whether a clock's ramp is over at `now`, counting a time within a few ulps of its end as past it:
 * host time far from 0 has lost the low bits that would put it exactly there.
 */
export function ended(c: Clock, now: number): boolean {
  const r = c.ramp;
  if (r === null) return true;
  const end = c.anchorNow + r.over;
  return now >= end - 4 * Number.EPSILON * Math.max(Math.abs(end), r.over);
}

/**
 * The ramp a clock is under at `now`: the rate it heads for and the ms left of it, from `now` on;
 * null once it has none or it has ended. Never more than the ramp's length, so a clock anchored
 * ahead of `now`, or not yet anchored, has all of it left.
 */
export function rampOf(c: Clock, now: number): { to: number; left: number } | null {
  const r = c.ramp;
  if (r === null) return null;
  const left = c.anchorNow + r.over - now;
  if (Number.isNaN(left)) return { to: r.to, left: r.over };
  if (ended(c, now)) return null;
  return { to: r.to, left: left > r.over ? r.over : left };
}

/** Mix time kept finite, so a clock run past the largest number stops there rather than at Infinity. */
export function clampTime(t: number): number {
  return t > Number.MAX_VALUE ? Number.MAX_VALUE : t < -Number.MAX_VALUE ? -Number.MAX_VALUE : t;
}

/** The time a clock reads `elapsed`, inverting `elapsedWith`; Infinity where it never will. */
export function timeWith(c: Clock, elapsed: number): number {
  const e0 = c.anchorElapsed;
  const r = c.ramp;
  if (r === null) {
    if (c.rate > 0) return c.anchorNow + (elapsed - e0) / c.rate;
    return elapsed <= e0 ? c.anchorNow : Number.POSITIVE_INFINITY;
  }
  if (elapsed <= e0) return r.from > 0 ? c.anchorNow + (elapsed - e0) / r.from : c.anchorNow;
  const a = (r.to - r.from) / (2 * r.over);
  const atEnd = e0 + r.from * r.over + a * r.over * r.over;
  // A ramp that turns the clock back reads furthest where its rate crosses 0, not at its end.
  const top = r.from > 0 && r.to < 0 ? e0 - (r.from * r.from) / (4 * a) : atEnd;
  if (elapsed <= top) {
    const k = e0 - elapsed;
    const dt =
      Math.abs(a) < 1e-12
        ? -k / r.from
        : (-r.from + Math.sqrt(Math.max(0, r.from * r.from - 4 * a * k))) / (2 * a);
    return c.anchorNow + dt;
  }
  if (r.to <= 0) return Number.POSITIVE_INFINITY;
  return c.anchorNow + r.over + (elapsed - atEnd) / r.to;
}

/**
 * Whether a clock runs back by its controls: at a rate below 0, or on a ramp between rates neither
 * of which is above it. A ramp through 0 says neither way until it has turned.
 */
export function backsWith(c: Clock): boolean {
  const r = c.ramp;
  return r === null ? c.rate < 0 : r.from <= 0 && r.to <= 0 && (r.from < 0 || r.to < 0);
}

/**
 * The time a clock running back reads `elapsed`: `timeWith` for the clock that reads the negative
 * of this one, which runs forward where this runs back.
 */
export function backWith(c: Clock, elapsed: number): number {
  const r = c.ramp;
  return timeWith(
    {
      anchorNow: c.anchorNow,
      anchorElapsed: -c.anchorElapsed,
      rate: -c.rate,
      ramp: r === null ? null : { from: -r.from, to: -r.to, over: r.over },
    },
    -elapsed,
  );
}

/**
 * The phase of a time before 0, for a loop with no first pass: where the pass before 0, and each
 * one before that, would read it.
 */
export function phaseBefore(elapsed: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const into = elapsed % duration;
  return (into < 0 ? into + duration : into) / duration;
}

/** A clock's rate at `now`. */
export function rateWith(c: Clock, now: number): number {
  const r = c.ramp;
  if (r === null) return c.rate;
  if (ended(c, now)) return r.to;
  const u = (now - c.anchorNow) / r.over;
  return u <= 0 ? r.from : r.from + (r.to - r.from) * u;
}

/** Moves a clock's anchor to `now`, carrying what is left of a ramp. */
export function rebaseWith(c: Clock, now: number): void {
  const rate = rateWith(c, now);
  c.anchorElapsed = elapsedWith(c, now);
  const r = c.ramp;
  if (r !== null)
    c.ramp = ended(c, now) ? null : { from: rate, to: r.to, over: c.anchorNow + r.over - now };
  c.anchorNow = now;
}

/**
 * Sets a clock's rate from `now`: at once, or moving there linearly over `over` ms from the rate it
 * has then, so what it reads stays continuous and so does its speed.
 */
export function retime(c: Clock, now: number, rate: number, over: number): void {
  rebaseWith(c, now);
  const from = rateWith(c, now);
  c.ramp = over > 0 && rate !== from ? { from, to: rate, over } : null;
  c.rate = rate;
}

/**
 * The fixed interval a voice's `step` runs at: its own `stepMs`, else the mix's. Undefined where
 * it steps once a frame by the frame's gap, as every voice does under reduced motion.
 */
export function stepOf(
  mix: { readonly opts: { readonly stepMs?: number }; readonly reducedNow: boolean },
  voice: { readonly spec: { readonly stepMs?: number } },
): number | undefined {
  const tick = voice.spec.stepMs ?? mix.opts.stepMs;
  return tick !== undefined && tick > 0 && !mix.reducedNow ? tick : undefined;
}

/** How long a fade of `ms` lasts on `mix`: none under reduced motion. */
export function fadeMsFor(mix: { readonly reduced: boolean }, ms: number): number {
  return mix.reduced ? 0 : ms;
}
