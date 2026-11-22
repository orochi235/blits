import { grown } from './grow.js';
import { Per } from './lane.js';
import type { Lanes } from './lanes.js';
import { unplace } from './rows.js';
import type { Seat } from './seat.js';
import type { Voice } from './voice.js';

// How the lanes number subjects and let them go, installed on `Lanes` as methods: see the foot of
// `lanes.ts`.

/** Numbers a subject the mix sees for the first time. */
export function number<I, O>(this: Lanes<I, O>, subject: I): number {
  const slot = this.numbers.take(subject);
  this.live++;
  this.grow(slot + 1);
  this.per[slot * Per.SLOT + Per.FILLED] = this.fills;
  this.per[slot * Per.SLOT + Per.SEEN] = -1;
  this.per[slot * Per.SLOT + Per.IDLE] = 0;
  this.per[slot * Per.SLOT + Per.LANE_PROBE] = 0;
  this.per[slot * Per.SLOT + Per.GENERAL_PROBE] = 0;
  this.per[slot * Per.SLOT + Per.LANE_FILL] = 0;
  if (this.filling) this.late.push(slot);
  this.off[slot] = this.whole ? 0 : 1;
  return slot;
}

/** Whether a subject the lanes filled has nothing left to fold: no voice off lanes reaches it. */
export function alone<I, O>(this: Lanes<I, O>, slot: number): boolean {
  return this.whole || (!this.offAll && this.off[slot] === 0);
}

export function release<I, O>(this: Lanes<I, O>, slot: number): void {
  this.numbers.release(slot);
}

/** Whether `slot` is a number a seek carried over whose chain has not been linked since. */
export function sought<I, O>(this: Lanes<I, O>, slot: number): boolean {
  return Number.isNaN(this.per[slot * Per.SLOT + Per.FILLED] as number);
}

/**
 * A chain is being linked for the subject at `slot`: one a seek carried over is from now on as
 * `number` leaves a subject it numbers. Says whether it was one.
 */
export function renew<I, O>(this: Lanes<I, O>, slot: number): boolean {
  if (!this.sought(slot)) return false;
  this.per[slot * Per.SLOT + Per.FILLED] = this.fills;
  if (this.filling) this.late.push(slot);
  this.off[slot] = this.whole ? 0 : 1;
  return true;
}

/** A voice brought a subject back: its next probe meets every lane again, as it met them first. */
export function rejoin<I, O>(this: Lanes<I, O>, slot: number): void {
  if (slot < this.cap) this.per[slot * Per.SLOT + Per.SEEN] = -1;
}

export function forget<I, O>(this: Lanes<I, O>, slot: number): void {
  this.host.forgot(slot);
  this.live--;
  for (const lane of this.lanes) lane.remove(slot);
  const placed = this.placed;
  for (let v = placed.any(slot); v !== undefined; v = placed.any(slot)) {
    const s = this.seatFor(v);
    if (s !== undefined && s.crowd.list[s.row] === slot && s.crowd.voices[s.row] === v)
      unplace(this, s.crowd, s.row);
    else placed.remove(slot, v);
  }
  if (slot < this.cap) this.per[slot * Per.SLOT + Per.FILLED] = this.fills;
  this.subjects[slot] = undefined;
}

/** `voice`'s seat here: the one it holds where it is these lanes', else the one kept by its id. */
export function seatFor<I, O>(this: Lanes<I, O>, voice: Voice<I, O>): Seat<I, O> | undefined {
  const s = voice.seat;
  return s !== null && s.lanes === this ? s : this.seats.get(voice.id);
}

export function grow<I, O>(this: Lanes<I, O>, size: number): void {
  if (size <= this.cap) return;
  const cap = Math.max(size, this.cap * 2, 64);
  this.per = grown(this.per, cap * Per.SLOT);
  this.owed.grow(cap);
  this.placed.grow(cap);
  this.unlinked = grown(this.unlinked, cap);
  const off = new Uint8Array(cap);
  off.set(this.off);
  this.off = off;
  for (const ch of this.laned) ch.values = grown(ch.values, cap * ch.axes);
  this.cap = cap;
}
