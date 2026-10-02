import type { Curve } from './easing.js';

/** How many passes a voice's `loop` plays. */
export function passesOf(loop: boolean | number | undefined): number {
  const l = loop ?? true;
  return l === true ? Number.POSITIVE_INFINITY : l === false ? 1 : l;
}

/** Where the last `place` put a voice: read it before the next call. */
export const placed = { phase: 0, pass: 0 };

/** Phase and pass `elapsed` voice ms into a patch of `period` ms playing `passes` passes. */
export function place(elapsed: number, period: number, passes: number): void {
  let phase = 0;
  let pass = 0;
  if (period > 0) {
    const done = Number.isFinite(passes) && elapsed >= period * passes;
    phase = done ? 1 : (elapsed % period) / period;
    pass = done ? passes - 1 : Math.floor(elapsed / period);
  }
  placed.phase = phase;
  placed.pass = pass;
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
