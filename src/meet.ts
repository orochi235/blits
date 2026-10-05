import { Flag, Hot } from './crowd.js';
import { type Lane, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Subject, Voice } from './voice.js';

/**
 * Whether the lanes a probe of the subject at `slot` just met (`met`) can be folded on the general
 * path after the lanes' values: none is in a locus or a crowd, the subject owes none already this
 * fill, and each comes after every other laned voice in voice order, so folding it last folds in
 * the general path's order.
 */
export function owable<I, O>(lanes: Lanes<I, O>, slot: number): boolean {
  if (lanes.metCrowd || lanes.owes(slot)) return false;
  // Subjects meeting the same lanes in one fill get the same answer, and a list is kept only once true.
  if (lanes.owed.last(lanes.met)) return true;
  const met = lanes.met;
  let other = Number.NEGATIVE_INFINITY;
  for (const lane of lanes.lanes) {
    const id = lane.voice.id;
    if (id > other && !met.includes(id)) other = id;
  }
  for (const c of lanes.crowds)
    if (c.size > 0) other = Math.max(other, c.hot[(c.size - 1) * c.stride + Hot.ID] as number);
  for (const id of met)
    if (id <= other || (lanes.byId.get(id) as Lane<I, O>).group !== null) return false;
  return true;
}

/**
 * Gives a probed subject a position on every lane that started playing since the subject was last
 * checked and that reaches it. True when any did, so the probe takes the general path.
 */
export function meet<I, O>(
  lanes: Lanes<I, O>,
  slot: number,
  subject: I,
  head: Subject<unknown> | null,
): boolean {
  const seen = lanes.per[slot * Per.SLOT + Per.SEEN] as number;
  const from = seen < 0 ? -1 - seen : seen;
  lanes.per[slot * Per.SLOT + Per.SEEN] = lanes.epochs;
  let met = false;
  lanes.met.length = 0;
  lanes.metCrowd = false;
  const dense = lanes.dense;
  for (let i = dense.length - 1; i >= 0; i--) {
    const lane = dense[i] as Lane<I, O>;
    if (lane.epoch <= from) break;
    if (lane.positionOf(slot) >= 0) continue;
    const held = lanes.host.meet(lane.voice, subject, head, slot);
    if (!held.reaches) continue;
    lane.add(slot, held);
    if (lane.idle) reach(lanes, slot, 1);
    lanes.met.push(lane.voice.id);
    met = true;
  }
  // `open` marks every subject a voice naming it starts on, so an unmarked one has none to meet.
  const naming = seen < 0 ? lanes.host.naming(subject) : undefined;
  if (naming !== undefined)
    for (const voice of naming) {
      const lane = lanes.byId.get(voice.id);
      if (lane === undefined) {
        if (place(lanes, voice, slot, subject, from, head)) {
          met = true;
          lanes.metCrowd = true;
        }
        continue;
      }
      if (lane.epoch <= from || lane.positionOf(slot) >= 0) continue;
      const held = lanes.host.meet(voice, subject, head, slot);
      if (!held.reaches) continue;
      lane.add(slot, held);
      if (lane.idle) reach(lanes, slot, 1);
      lanes.met.push(voice.id);
      met = true;
    }
  return met;
}

/** Places a crowd voice's row on the subject a probe met, as `Lane.add` adds a position. */
function place<I, O>(
  lanes: Lanes<I, O>,
  voice: Voice<I, O>,
  slot: number,
  subject: I,
  from: number,
  head: Subject<unknown> | null,
): boolean {
  const c = lanes.crowdOf.get(voice.id);
  const p = c?.rowOf.get(voice.id);
  if (c === undefined || p === undefined) return false;
  const h = p * c.stride;
  const flags = c.hot[h + Hot.FLAGS] as number;
  if ((c.hot[h + Hot.EPOCH] as number) <= from || (flags & Flag.PLACED) !== 0) return false;
  const held = lanes.host.meet(voice, subject, head, slot);
  if (!held.reaches) return false;
  const o = p * Row.STRIDE;
  c.list[p] = slot;
  c.data[o + Row.DELAY] = held.delay;
  c.data[o + Row.SINCE] = held.shown;
  c.data[o + Row.WEIGHT] = 0;
  c.data[o + Row.PROBED] = 0;
  c.data[o + Row.MSLOT] = -1;
  c.data[o + Row.SAMPLED] = -1;
  c.data[o + Row.MET] = 0;
  c.records[p] = held;
  c.deltas[p] = null;
  c.restale(p, flags | Flag.PLACED);
  if (c.idle) reach(lanes, slot, 1);
  return true;
}

/** Counts an idle lane more or fewer reaching a subject. */
export function reach<I, O>(lanes: Lanes<I, O>, slot: number, by: number): void {
  const i = slot * Per.SLOT + Per.IDLE;
  lanes.per[i] = (lanes.per[i] as number) + by;
}
