import type { Curve } from './easing.js';

/** How many passes a voice's `loop` plays. */
export function passesOf(loop: boolean | number | undefined): number {
  const l = loop ?? true;
  return l === true ? Number.POSITIVE_INFINITY : l === false ? 1 : l;
}

/** Whether `elapsed` voice ms is past the last of `passes` passes of a patch of `period` ms. */
const over = (elapsed: number, period: number, passes: number): boolean =>
  Number.isFinite(passes) && elapsed >= period * passes;

/**
 * The phase `elapsed` voice ms into a patch of `period` ms playing `passes` passes, held at 1 once
 * they are done. A pure function rather than one writing phase and pass together, so a hot caller
 * keeps both in registers.
 */
export function phaseAt(elapsed: number, period: number, passes: number): number {
  if (!(period > 0)) return 0;
  return over(elapsed, period, passes) ? 1 : (elapsed % period) / period;
}

/** The pass `elapsed` voice ms falls in, held at the last once they are done. */
export function passAt(elapsed: number, period: number, passes: number): number {
  if (!(period > 0)) return 0;
  return over(elapsed, period, passes) ? passes - 1 : Math.floor(elapsed / period);
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
