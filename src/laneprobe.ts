import { fillAll } from './fill.js';
import { Begin, Per } from './lane.js';
import type { Lanes } from './lanes.js';
import { meet } from './meet.js';
import { requalify, retouch } from './qualify.js';
import { reading } from './reading.js';
import type { Subject } from './subject.js';

// What a probe asks of the lanes, installed on `Lanes` as methods: see the foot of `lanes.ts`.

/**
 * Fills the lanes once a frame, and says whether this probe of a subject reads its values from
 * them. One that a lane has not met yet, newly numbered or newly reached, takes the general path
 * this frame, which is where it is first seen; so does one probed from inside a fill.
 */
export function prepare<I, O>(
  this: Lanes<I, O>,
  slot: number,
  subject: I,
  version: number,
  head: Subject<unknown> | null,
): boolean {
  // Read, not passed: a double passed to a call V8 does not inline is boxed, once a probe.
  const now = this.host.clock.now;
  if (!this.filled(now, version) && this.begin(now, version) === Begin.GENERAL)
    return this.general(slot);
  if (slot < 0) return false;
  if (!this.probedThisFrame(slot)) this.distinct++;
  const probe = ++this.probes;
  const per = this.per;
  const o = slot * Per.SLOT;
  let lane = (per[o + Per.FILLED] as number) < this.busyFill && per[o + Per.IDLE] === 0;
  if ((per[o + Per.SEEN] as number) < this.wide) lane = meet(this, slot, subject, head, lane);
  if (lane) {
    per[o + Per.LANE_PROBE] = probe;
    per[o + Per.LANE_FILL] = this.fills;
    if (this.holds) {
      this.subjects[slot] = subject;
      this.holding = true;
    }
  } else per[o + Per.GENERAL_PROBE] = probe;
  return lane;
}

/** Whether this frame's lanes are filled and nothing since asks `begin` to look again. */
export function filled<I, O>(this: Lanes<I, O>, now: number, version: number): boolean {
  return (
    this.frameAt === now &&
    this.qualifiedVersion === version &&
    this.touched.length === 0 &&
    !this.filling &&
    this.current(now, version)
  );
}

/**
 * Whether the last fill still stands: everything a fill reads that can change between two probes,
 * each stamped by `fillAll`. The clock; the mix's version, which voices coming, going, starting
 * and stopping move; a motion's retargets and pushes; and a `level` set. Whatever else can change
 * between probes keeps its voice off lanes in `unfit`.
 */
export function current<I, O>(this: Lanes<I, O>, now: number, version: number): boolean {
  return (
    this.filledAt === now &&
    this.filledVersion === version &&
    this.moved === reading.moved &&
    this.inputs === reading.inputs
  );
}

/**
 * What a probe does before its subject, once a frame's lanes are settled: qualifies and fills as
 * needed. Says whether the subject takes the general path or the lanes are filled.
 */
export function begin<I, O>(this: Lanes<I, O>, now: number, version: number): number {
  if (now !== this.frameAt) {
    this.lastFrom = this.frameProbes;
    this.lastTo = this.probes;
    this.lastDistinct = this.distinct;
    this.distinct = 0;
    this.frameAt = now;
    this.frameProbes = this.probes;
    this.fresh = true;
  }
  if (this.filling) return Begin.GENERAL;
  // Past a qualify that stands, the mix's version moves when a voice over every subject comes,
  // goes, starts or stops waiting, each of which touches it, or stops sharing one record, which
  // moves no voice on or off a lane: so with voices touched it is a set of touches.
  if (this.qualifiedVersion !== version) {
    if (!Number.isNaN(this.qualifiedVersion) && this.touched.length > 0 && retouch(this))
      this.qualifiedVersion = version;
    else requalify(this, version);
  } else if (this.touched.length > 0 && !retouch(this)) requalify(this, version);
  if (this.laned.length === 0) return Begin.GENERAL;
  if (!this.current(now, version)) {
    fillAll(this, now, version);
    // A patch call in that fill made kept state, which took its voice off its lane: fill without it.
    if (this.qualifiedVersion !== version) {
      requalify(this, version);
      if (this.laned.length === 0) return Begin.GENERAL;
      fillAll(this, now, version);
    }
  }
  return Begin.READY;
}

export function general<I, O>(this: Lanes<I, O>, slot: number): false {
  if (slot >= 0) this.per[slot * Per.SLOT + Per.GENERAL_PROBE] = ++this.probes;
  return false;
}

/**
 * Whether this fill leaves the subject at `slot` to the general path, for not having been probed
 * this frame or the last: a probe of it before the next fill then takes the general path.
 */
export function unread<I, O>(this: Lanes<I, O>, slot: number): boolean {
  const per = this.per;
  const o = slot * Per.SLOT;
  const lately = this.lately;
  if (
    (per[o + Per.LANE_PROBE] as number) > lately ||
    (per[o + Per.GENERAL_PROBE] as number) > lately
  )
    return false;
  per[o + Per.FILLED] = this.fills;
  return true;
}

/** Whether a probe has read the subject since the frame began, on either path. */
export function probedThisFrame<I, O>(this: Lanes<I, O>, slot: number): boolean {
  const from = this.frameProbes;
  const o = slot * Per.SLOT;
  return (
    (this.per[o + Per.LANE_PROBE] as number) > from ||
    (this.per[o + Per.GENERAL_PROBE] as number) > from
  );
}

/**
 * Whether a subject's laned values are at their channels' rest, as `atRest` reads the pose `copy`
 * would write: each number within 1e-9 of its rest.
 */
export function rests<I, O>(this: Lanes<I, O>, slot: number): boolean {
  for (const ch of this.laned) {
    const values = ch.values;
    if (ch.op === 'last') {
      if (!Number.isNaN(values[slot * ch.axes] as number)) return false;
      continue;
    }
    if (ch.scalar) {
      if (!(Math.abs((values[slot] as number) - ch.rest) < 1e-9)) return false;
      continue;
    }
    // `copy` lengthens a rest shorter than the channel's axes, and a longer array is never near it.
    if (ch.start.length < ch.axes) return false;
    const base = slot * ch.axes;
    for (let a = 0; a < ch.axes; a++)
      if (!(Math.abs((values[base + a] as number) - (ch.start[a] as number)) < 1e-9)) return false;
  }
  return true;
}
