import { type Bound, foundIn } from './bound.js';
import type { Lanes } from './lanes.js';
import { absent } from './numbers.js';
import type { Places } from './places.js';
import type { Voice } from './voice.js';

/**
 * Marks afresh where a voice off lanes may reach. While the lanes are not `whole`: `offAll` where it
 * may reach any subject (`offWide` where one naming none is bounded by nothing it tracks), and in
 * `off` by subject number, bit 1 where one naming its subjects may and bit 2 where one of
 * `offBounds` may this frame (`markBounds`, last at frame `boundsAt`, on `boundSlots`). All 0 while
 * `whole`.
 */
export function markOff<I, O>(lanes: Lanes<I, O>): void {
  lanes.off.fill(0);
  lanes.offWide = false;
  lanes.offAll = false;
  lanes.offBounds.length = 0;
  lanes.boundSlots.length = 0;
  lanes.boundsAt = Number.NaN;
  if (lanes.whole) return;
  for (const v of lanes.host.voices)
    if (v.state !== 'done' && v.holding === null && v.offLane !== undefined) markReach(lanes, v);
}

/**
 * Marks every subject numbered that a voice off lanes may reach. One naming none reaches them all,
 * unless a bound it tracks the reads of says where it reaches each frame (`markBounds`).
 */
export function markReach<I, O>(lanes: Lanes<I, O>, v: Voice<I, O>): void {
  if (v.named === null) {
    if (v.bound?.reads == null) {
      lanes.offWide = true;
      lanes.offAll = true;
    } else if (!lanes.offBounds.includes(v)) {
      lanes.offBounds.push(v);
      lanes.boundsAt = Number.NaN;
    }
    return;
  }
  for (const subject of v.named.list) {
    const slot = lanes.host.slotOf(subject);
    if (slot >= 0 && slot < lanes.cap) lanes.off[slot] = (lanes.off[slot] as number) | 1;
  }
}

/**
 * Marks, for this frame, the subjects a bounded voice off lanes naming none may change on the
 * general path: those within its bound, and those a read gave a weight other than 0, which a read
 * outside sets back to 0. A read outside does nothing else, so every other subject reads from the
 * lanes alone. Each mark is bit 2 of `Lanes.off`, cleared at the next frame's marking.
 */
export function markBounds<I, O>(lanes: Lanes<I, O>): void {
  lanes.boundsAt = lanes.host.clock.frame;
  const off = lanes.off;
  const marked = lanes.boundSlots;
  for (let k = 0; k < marked.length; k++) {
    const slot = marked[k] as number;
    off[slot] = (off[slot] as number) & 1;
  }
  marked.length = 0;
  lanes.offAll = lanes.offWide;
  if (lanes.offAll) return;
  const cap = lanes.cap;
  for (const v of lanes.offBounds) {
    const b = v.bound as Bound<I, O>;
    const reads = b.reads;
    if (reads === null) {
      lanes.offAll = true;
      return;
    }
    const places = b.mix.places as Places<I>;
    const count = foundIn(b);
    const found = places.found;
    for (let k = 0; k < count; k++) {
      const slot = places.slots[found[k] as number] ?? -1;
      if (slot < 0 || slot >= cap || (off[slot] as number) & 2) continue;
      off[slot] = (off[slot] as number) | 2;
      marked.push(slot);
    }
    for (const [held, slot] of reads) {
      // Its subject gone, or the number another's: nothing will read the record again.
      const subject = lanes.numbers.subject(slot);
      if (
        subject === absent ||
        v.subjects.get(subject) !== held ||
        (Object.is(held.weight, 0) && unbanded(held.bands))
      ) {
        reads.delete(held);
        continue;
      }
      if (slot >= cap || (off[slot] as number) & 2) continue;
      off[slot] = (off[slot] as number) | 2;
      marked.push(slot);
    }
  }
}

function unbanded(bands: Uint8Array | null): boolean {
  if (bands === null) return true;
  for (let i = 0; i < bands.length; i++) if (bands[i] !== 2) return false;
  return true;
}
