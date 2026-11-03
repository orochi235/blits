import type { Target } from './drive.js';

/**
 * How near, in seconds, a hold may come to a point already scheduled. Tone's `cancelAndHoldAtTime`
 * within about a microsecond of one, either side, loses the line into it and can flatten the
 * curve before it; at the point itself it holds cleanly.
 */
const NEAR = 2e-6;

/** Each target's points scheduled since its last hold, in seconds, ascending. */
const sent = new WeakMap<Target, number[]>();

/**
 * Cancels what `target` has scheduled after `time` and holds the value it reaches there, or at a
 * point already scheduled within `NEAR` of it. Returns the time it held at.
 */
export function hold(target: Target, time: number): number {
  let at = time;
  for (const t of sent.get(target) ?? [])
    if (Math.abs(t - time) < NEAR) {
      at = t;
      break;
    }
  target.cancelAndHoldAtTime(at);
  sent.set(target, [at]);
  return at;
}

/** `target.linearRampToValueAtTime`, noted for `hold`. */
export function ramp(target: Target, value: number, time: number): void {
  target.linearRampToValueAtTime(value, time);
  sent.get(target)?.push(time);
}

/** `target.setValueAtTime`, noted for `hold`. */
export function set(target: Target, value: number, time: number): void {
  target.setValueAtTime(value, time);
  sent.get(target)?.push(time);
}
