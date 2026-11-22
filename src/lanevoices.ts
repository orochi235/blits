import { lit } from './bound.js';
import { Flag, Hot } from './crowd.js';
import { type Lane, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import { reach } from './meet.js';
import { absent } from './numbers.js';
import { reportedRow, unplace } from './rows.js';
import { seatOf } from './seat.js';
import type { Subject } from './subject.js';
import type { Voice } from './voice.js';

// What the lanes are told of a voice, and report of one, installed on `Lanes` as methods: see the
// foot of `lanes.ts`.

/** A voice faded a subject out of itself alone: its lane lets the subject's position go. */
export function part<I, O>(this: Lanes<I, O>, id: number, slot: number): void {
  const lane = this.byId.get(id);
  if (lane !== undefined) {
    if (lane.positionOf(slot) < 0) return;
    if (lane.idle) reach(this, slot, -1);
    lane.remove(slot);
    return;
  }
  const s = this.seats.get(id);
  if (s !== undefined && s.crowd.list[s.row] === slot) unplace(this, s.crowd, s.row);
}

/**
 * A laned voice's weight for a subject at the last frame a probe read it from the lane; undefined
 * where the subject's record holds it instead, because its last probe took the general path or
 * the voice is not on a lane.
 */
export function weightOf<I, O>(this: Lanes<I, O>, id: number, slot: number): number | undefined {
  if (slot < 0) return undefined;
  const lane = this.byId.get(id);
  if (lane !== undefined) return this.reported(lane, slot);
  const s = this.seats.get(id);
  return s === undefined ? undefined : reportedRow(this, s.crowd, s.row, slot);
}

export function reported<I, O>(
  this: Lanes<I, O>,
  lane: Lane<I, O>,
  slot: number,
): number | undefined {
  const o = slot * Per.SLOT;
  const probe = this.per[o + Per.LANE_PROBE] as number;
  if (!(probe > (this.per[o + Per.GENERAL_PROBE] as number)) || !(probe > lane.made))
    return undefined;
  const p = lane.positionOf(slot);
  if (p < 0) return undefined;
  return lane.data[
    p * Row.STRIDE + (this.per[o + Per.LANE_FILL] === this.fills ? Row.WEIGHT : Row.PROBED)
  ];
}

/** Whether the subject at `slot` reads some laned voice from the general path this fill. */
export function owes<I, O>(this: Lanes<I, O>, slot: number): boolean {
  return this.owed.owes(slot);
}

/** Whether the subject at `slot` reads laned voice `id` from the general path this fill. */
export function owesVoice<I, O>(this: Lanes<I, O>, slot: number, id: number): boolean {
  return this.owed.owesVoice(slot, id);
}

/** The weight the general path gave a voice the subject at `slot` owes, as `weightOf` reports. */
export function paid<I, O>(this: Lanes<I, O>, id: number, slot: number, w: number): void {
  const lane = this.byId.get(id);
  const p = lane === undefined ? -1 : lane.positionOf(slot);
  if (p < 0) return;
  (lane as Lane<I, O>).data[p * Row.STRIDE + Row.WEIGHT] = w;
  const b = (lane as Lane<I, O>).voice.bound;
  if (b !== null && w !== 0) lit(b, slot, this.fills);
}

/**
 * A laned voice's patch is about to change subject `s`'s stretch: a crowd copies it again at the
 * next fill, and a lane keeps the sample the old one gave.
 */
export function stretchChanged<I, O>(this: Lanes<I, O>, id: number, s: number): void {
  const seat = this.seats.get(id);
  if (seat !== undefined) {
    const c = seat.crowd;
    c.restale(seat.row, c.hot[seat.row * c.stride + Hot.FLAGS] as number);
    return;
  }
  const lane = this.byId.get(id);
  const q = lane === undefined ? -1 : lane.positionOfMotion(s);
  if (q >= 0) (lane as Lane<I, O>).fix(q);
}

/**
 * A voice that kept one record for every subject keeps one each from now on: each of its lane's
 * positions takes the record `of` gives its subject.
 */
export function rerecord<I, O>(
  this: Lanes<I, O>,
  id: number,
  of: (subject: I, slot: number) => Subject<unknown>,
): void {
  const lane = this.byId.get(id);
  if (lane === undefined) return;
  for (let p = 0; p < lane.list.length; p++) {
    const slot = lane.list[p] as number;
    const subject = this.subjectAt(slot);
    if (subject !== absent) lane.records[p] = of(subject as I, slot);
  }
}

/** A voice's clock moved the `shown` of records it had already placed: copies them again. */
export function reshown<I, O>(this: Lanes<I, O>, id: number): void {
  const s = this.seats.get(id);
  if (s !== undefined) {
    const held = s.crowd.records[s.row];
    if (held !== undefined) s.crowd.data[s.row * Row.STRIDE + Row.SINCE] = held.shown;
  }
  const lane = this.byId.get(id);
  if (lane === undefined) return;
  lane.latestSince = Number.NEGATIVE_INFINITY;
  for (let q = 0; q < lane.list.length; q++) {
    const held = lane.records[q];
    if (held !== undefined) lane.data[q * Row.STRIDE + Row.SINCE] = held.shown;
    lane.since(lane.data[q * Row.STRIDE + Row.SINCE] as number);
  }
}

/** Something on a voice changed: a crowd copies it again at the next fill. */
export function voiceChanged<I, O>(this: Lanes<I, O>, voice: Voice<I, O>): void {
  const s = seatOf(this, voice);
  if (s === null) return;
  const c = s.crowd;
  const f = s.row * c.stride + Hot.FLAGS;
  c.hot[f] = (c.hot[f] as number) | Flag.VOICE;
}
