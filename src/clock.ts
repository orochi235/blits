import type { Curve } from './easing.js';

/** How many passes a voice's `loop` plays. */
export function passesOf(loop: boolean | number | undefined): number {
  const l = loop ?? true;
  return l === true ? Number.POSITIVE_INFINITY : l === false ? 1 : l;
}

/** Whether `elapsed` voice ms is past the last of `passes` passes of a patch of `duration` ms. */
const over = (elapsed: number, duration: number, passes: number): boolean =>
  Number.isFinite(passes) && elapsed >= duration * passes;

/**
 * The phase `elapsed` voice ms into a patch of `duration` ms playing `passes` passes, held at 1 once
 * they are done. A pure function rather than one writing phase and pass together, so a hot caller
 * keeps both in registers.
 */
export function phaseAt(elapsed: number, duration: number, passes: number): number {
  if (!(duration > 0)) return 0;
  return over(elapsed, duration, passes) ? 1 : (elapsed % duration) / duration;
}

/** The pass `elapsed` voice ms falls in, held at the last once they are done. */
export function passAt(elapsed: number, duration: number, passes: number): number {
  if (!(duration > 0)) return 0;
  return over(elapsed, duration, passes) ? passes - 1 : Math.floor(elapsed / duration);
}

/** A voice's own fade this frame, 0..1: in from `since` over `fadeIn`, and out along its ramp. */
export function envelope(
  fadeIn: number,
  out: { at: number; over: number; rest: boolean } | null,
  ease: Curve | undefined,
  reduced: boolean,
  now: number,
  since: number,
): number {
  let w = 1;
  if (fadeIn > 0 && !reduced) {
    const u = (now - since) / fadeIn;
    if (u < 1) w *= ease ? ease(Math.max(0, u)) : Math.max(0, u);
  }
  if (out && !out.rest) {
    if (reduced || out.over === 0) return 0;
    const u = 1 - (now - out.at) / out.over;
    const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
    w *= ease ? ease(clamped) : clamped;
  }
  return w;
}

/**
 * A subject's voice time `raw` once the voice's holds apply: 0 before it starts if it holds before,
 * else NaN, where it shows nothing; `span` once its passes end if it holds after.
 */
export function heldTime(raw: number, before: boolean, after: boolean, span: number): number {
  if (raw < 0) return before ? 0 : Number.NaN;
  return after && raw > span ? span : raw;
}

/** A weight held to 0..1. */
export function clampWeight(raw: number): number {
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
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
  if (r === null) return c.anchorElapsed + dt * c.rate;
  if (dt <= 0) return c.anchorElapsed + dt * r.from;
  const d = r.to - r.from;
  if (dt <= r.over) return c.anchorElapsed + r.from * dt + (d * dt * dt) / (2 * r.over);
  return c.anchorElapsed + r.from * r.over + (d * r.over) / 2 + r.to * (dt - r.over);
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
  if (elapsed <= atEnd) {
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

/** A clock's rate at `now`. */
export function rateWith(c: Clock, now: number): number {
  const r = c.ramp;
  if (r === null) return c.rate;
  const u = (now - c.anchorNow) / r.over;
  return u >= 1 ? r.to : u <= 0 ? r.from : r.from + (r.to - r.from) * u;
}

/** Moves a clock's anchor to `now`, carrying what is left of a ramp. */
export function rebaseWith(c: Clock, now: number): void {
  const rate = rateWith(c, now);
  c.anchorElapsed = elapsedWith(c, now);
  const r = c.ramp;
  if (r !== null) {
    const left = c.anchorNow + r.over - now;
    c.ramp = left > 0 ? { from: rate, to: r.to, over: left } : null;
  }
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
