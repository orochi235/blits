import { stateful } from './hosts.js';
import type { Mixer } from './mixer.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import type { Setting, Signal } from './types.js';
import type { Subject, Voice } from './voice.js';

/** A `mix.blend`'s one signal, read once for all its members. */
export interface Blend<I, O> {
  by: Signal<I>;
  stops: number;
  members: Voice<I, O>[];
  /** The general path's last read: its frame, its subject, and the value. */
  frame: number;
  subject: I | undefined;
  value: number;
  /** The general path's read of each subject, for one probed again after another in its frame. */
  reads: Store<I, { frame: number; value: number }>;
  /** Lanes' reads by subject number: the frame each is from, and the value. */
  frames: Float64Array;
  values: Float64Array;
}

export function blendOf<I, O>(by: Signal<I>, stops: number): Blend<I, O> {
  return {
    by,
    stops,
    members: [],
    frame: 0,
    subject: undefined,
    value: 0,
    reads: new Store(),
    frames: new Float64Array(0),
    values: new Float64Array(0),
  };
}

/** Gives a projection's copies blends of their own, so its reads never overwrite the mix's. */
export function ownBlends<I, O>(voices: Voice<I, O>[]): void {
  const own = new Map<Blend<I, O>, Blend<I, O>>();
  for (const v of voices) {
    if (v.blend === null) continue;
    let of = own.get(v.blend.of);
    if (of === undefined) {
      of = blendOf(v.blend.of.by, v.blend.of.stops);
      own.set(v.blend.of, of);
    }
    v.blend = { of, i: v.blend.i };
    of.members.push(v);
  }
}

/** A blend member's weight for its signal's read `k`: the members' stops sit evenly along 0..1. */
function shareOf(k: number, i: number, stops: number): number {
  const d = stops === 0 ? 0 : Math.abs(k * stops - i);
  return d >= 1 ? 0 : 1 - d;
}

/** A blend member's share of its signal's read for this subject this frame, made by the first to ask. */
export function blended<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown>,
  slot: number,
): number {
  const { of, i } = voice.blend as { of: Blend<I, O>; i: number };
  const frame = this.frame;
  let cell: { frame: number; value: number } | undefined;
  if (slot < 0) {
    if (of.frame === frame && of.subject === subject) return shareOf(of.value, i, of.stops);
    cell = of.reads.get(subject);
    if (cell?.frame === frame) return shareOf(cell.value, i, of.stops);
  } else if (slot < of.frames.length) {
    const read = this.laneRead(voice, slot);
    if (!Number.isNaN(read)) return read;
  } else {
    const size = Math.max(slot + 1, of.frames.length * 2, 64);
    const frames = new Float64Array(size);
    const values = new Float64Array(size);
    frames.set(of.frames);
    values.set(of.values);
    of.frames = frames;
    of.values = values;
  }
  const kept = reading.kept;
  const k = of.by(subject, voice.setting as Setting);
  if (reading.kept !== kept && !this.projecting) this.shareKept(of, voice, subject, held);
  if (slot < 0) {
    of.frame = frame;
    of.subject = subject;
    of.value = k;
    if (cell === undefined) of.reads.set(subject, { frame, value: k });
    else {
      cell.frame = frame;
      cell.value = k;
    }
  } else {
    of.frames[slot] = frame;
    of.values[slot] = k;
  }
  return shareOf(k, i, of.stops);
}

/** A blend member's share of the read lanes made of its signal for subject `slot` this frame; NaN for none. */
export function laneRead<I, O>(this: Mixer<I, O>, voice: Voice<I, O>, slot: number): number {
  const { of, i } = voice.blend as { of: Blend<I, O>; i: number };
  return slot < of.frames.length && of.frames[slot] === this.frame
    ? shareOf(of.values[slot] as number, i, of.stops)
    : Number.NaN;
}

/**
 * A blend's signal kept state on one member's record: the others' records for the subject hold
 * the same, so whichever member reads next steps it, and every member leaves its lane.
 */
export function shareKept<I, O>(
  this: Mixer<I, O>,
  of: Blend<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown>,
): void {
  for (const m of of.members) {
    const h = m === voice ? undefined : (m.subjects.get(subject) as Subject<unknown> | undefined);
    if (h?.reaches && h.kept === null) h.kept = held.kept;
    stateful(this, m);
  }
}
