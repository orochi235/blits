import type { Laned } from './lane.js';
import type { Lanes } from './lanes.js';

/**
 * Writes a subject's laned values into a pose, each array channel into the array the pose holds
 * for it where that is the length a new one would be, as a host's `out` holds from its last probe.
 */
export function copy<I, O>(this: Lanes<I, O>, slot: number, pose: Record<string, unknown>): void {
  const laned = this.laned;
  for (let c = 0; c < laned.length; c++) {
    const ch = laned[c] as Laned;
    const axes = ch.axes;
    // Never `delete`: it drops a reused out object into dictionary mode for good.
    if (ch.op === 'last' && Number.isNaN(ch.values[slot * axes] as number)) {
      if (pose[ch.name] !== undefined) pose[ch.name] = undefined;
      continue;
    }
    if (ch.scalar) {
      pose[ch.name] = ch.values[slot] as number;
      continue;
    }
    // Made as the general path makes it, a copy of rest, so poses from either path share a shape.
    const start = ch.start;
    const base = slot * axes;
    const held = pose[ch.name];
    if (
      Array.isArray(held) &&
      held !== start &&
      held.length === (start.length > axes ? start.length : axes)
    ) {
      for (let a = 0; a < axes; a++) held[a] = ch.values[base + a] as number;
      for (let a = axes; a < start.length; a++) held[a] = start[a] as number;
      continue;
    }
    const arr = [...start];
    for (let a = 0; a < axes; a++) arr[a] = ch.values[base + a] as number;
    pose[ch.name] = arr;
  }
}
