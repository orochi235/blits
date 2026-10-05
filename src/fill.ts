import { foldNumber, lerpNumber } from './channels.js';
import { passAt, phaseAt, silent, weighed } from './clock.js';
import { flush } from './columns.js';
import { crowdsUpTo, freshen } from './crowd.js';
import { foldLocus, gatherLocus } from './gather.js';
import { held, type Lane, type Laned, type Paced, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import { reach } from './meet.js';
import type { Subject, Voice } from './mixer.js';
import { absent } from './numbers.js';
import { AT, NOTHING, readKeys, type Scratch, seg, segment, shifted, type Track } from './patch.js';
import { reading } from './reading.js';
import { move, runMotion } from './sample.js';

/** The least prime at least `n`, and 1 below 2. */
function primeFrom(n: number): number {
  if (n < 2) return 1;
  for (let c = n; ; c++) {
    let prime = true;
    for (let d = 2; d * d <= c; d++)
      if (c % d === 0) {
        prime = false;
        break;
      }
    if (prime) return c;
  }
}

export function fillAll<I, O>(lanes: Lanes<I, O>, now: number, version: number): void {
  flush(lanes);
  const host = lanes.host;
  lanes.filling = true;
  try {
    lanes.fills++;
    lanes.owed.begin(lanes.fills);
    lanes.now = now;
    lanes.filledAt = now;
    lanes.filledVersion = version;
    const size = lanes.numbers.size;
    lanes.keeps = host.keeps;
    const decide = lanes.fresh;
    lanes.fresh = false;
    const share = lanes.live > 0 ? lanes.lastDistinct / lanes.live : 1;
    // Deciding which lanes and crowds go idle first, then running them, in voice order: a crowd's
    // rows are folded between the lanes on either side of their voices, as the general path
    // folds every voice in order.
    let busy = false;
    for (const lane of lanes.lanes) {
      if (decide) {
        // A lane with few subjects, such as one naming its own, goes by the share of all probed;
        // one with a single subject shares nothing a fill could save, as a solo lane does not.
        const line = lane.line;
        const n = lane.list.length;
        if (n >= 64) pace(lanes, lane);
        else if (n === 1 && lane.motion === undefined) {
          if (!lane.idle) rest(lanes, lane);
        } else if (lane.idle ? share >= line.start : share < line.stop) flip(lanes, lane);
      }
      if (!lane.idle) busy = true;
    }
    for (const c of lanes.crowds) {
      if (decide) {
        if (c.size >= 64) pace(lanes, c);
        else if (c.idle ? share >= c.line.start : share < c.line.stop) flip(lanes, c);
      }
      c.cursor = 0;
      if (c.stale) freshen(c);
      if (!c.idle && c.size > 0) busy = true;
    }
    if (busy) {
      for (const ch of lanes.laned) ch.values.fill(ch.rest, 0, size * ch.axes);
      for (const g of lanes.loci) gatherLocus(lanes, g);
      for (const lane of lanes.lanes) {
        if (lane.idle) continue;
        if (lanes.crowds.length > 0) crowdsUpTo(lanes, lane.voice.id);
        lanes.run(lane);
      }
      if (lanes.crowds.length > 0) crowdsUpTo(lanes, Number.POSITIVE_INFINITY);
    }
    // With every lane idle there was nothing to fill, and no subject reads a lane this frame.
    if (busy) for (let s = 0; s < size; s++) lanes.per[s * Per.SLOT + Per.FILLED] = lanes.fills;
    for (const slot of lanes.late) lanes.per[slot * Per.SLOT + Per.FILLED] = 0;
    if (lanes.holding) {
      lanes.subjects.fill(undefined, 0, size);
      lanes.holding = false;
    }
    lanes.moved = reading.moved;
  } finally {
    lanes.filling = false;
    lanes.late.length = 0;
  }
}

/**
 * Sets a lane idle or busy by the share of its subjects probed in the last frame that had a probe,
 * read from about 256 of them a prime stride apart, from an offset that moves each frame, so a host
 * probing every second or third subject is not read as probing all or none. Both paths give the
 * same values, so this only picks the cheaper.
 */
function pace<I, O>(lanes: Lanes<I, O>, lane: Paced): void {
  const list = lane.list;
  const line = lane.line;
  const from = lanes.lastFrom;
  const to = lanes.lastTo;
  const step = primeFrom(Math.floor(list.length / 256));
  let looked = 0;
  let probed = 0;
  for (let p = lanes.fills % step; p < list.length; p += step) {
    const slot = list[p] as number;
    if (slot < 0) continue;
    const a = lanes.per[slot * Per.SLOT + Per.LANE_PROBE] as number;
    const b = lanes.per[slot * Per.SLOT + Per.GENERAL_PROBE] as number;
    if ((a > from && a <= to) || (b > from && b <= to)) probed++;
    looked++;
  }
  const share = looked > 0 ? probed / looked : 1;
  if (lane.idle ? share >= line.start : share < line.stop) flip(lanes, lane);
}

function flip<I, O>(lanes: Lanes<I, O>, lane: Paced): void {
  if (lane.idle) wake(lanes, lane);
  else rest(lanes, lane);
}

/** Leaves a lane's subjects to the general path until it wakes, keeping what `weightOf` reports. */
export function rest<I, O>(lanes: Lanes<I, O>, lane: Paced): void {
  lane.idle = true;
  const list = lane.list;
  const data = lane.data;
  for (let p = 0; p < list.length; p++) {
    const slot = list[p] as number;
    if (slot < 0) continue;
    reach(lanes, slot, 1);
    // A probe read this subject from the last fill, which this lane's weight stays from.
    if (lanes.per[slot * Per.SLOT + Per.LANE_FILL] === lanes.fills - 1) {
      const o = p * Row.STRIDE;
      data[o + Row.PROBED] = data[o + Row.WEIGHT] as number;
    }
  }
}

export function wake<I, O>(lanes: Lanes<I, O>, lane: Paced): void {
  lane.idle = false;
  for (const slot of lane.list) if (slot >= 0) reach(lanes, slot, -1);
}

/**
 * A voice with a signal weight: its weight for the subject at `slot` under the voice's fade `fade`,
 * through the general path's own arithmetic; NaN where that path has not made the voice's first
 * call for the subject, which it then makes this frame, so a signal that keeps state is first
 * called where the general path would call it.
 */
export function signalled<I, O>(
  this: Lanes<I, O>,
  voice: Voice<I, O>,
  slot: number,
  rec: Subject<unknown>,
  elapsed: number,
  pass: number,
  fade: number,
): number {
  if (Number.isNaN(rec.probed)) {
    this.late.push(slot);
    return Number.NaN;
  }
  const subject = this.subjectAt(slot);
  if (subject === absent) return 0;
  const base = this.host.signal(voice, subject, rec, elapsed, pass, slot);
  return weighed(base, fade, voice.parts === null ? 1 : this.host.parting(voice, subject));
}

/** What a subject's own ramp out of a voice leaves of its weight: 1 with none. */
export function parting<I, O>(this: Lanes<I, O>, voice: Voice<I, O>, slot: number): number {
  if (voice.parts === null) return 1;
  const subject = this.subjectAt(slot);
  return subject === absent ? 1 : this.host.parting(voice, subject);
}

export function subjectAt<I, O>(this: Lanes<I, O>, slot: number): I | typeof absent {
  let subject = this.subjects[slot];
  if (subject === undefined) {
    subject = this.numbers.subject(slot);
    this.subjects[slot] = subject;
    this.holding = true;
  }
  return subject;
}

/** What a lane remembers within one fill, cleared before the fill runs it. */
export function reset<I, O>(this: Lanes<I, O>, lane: Lane<I, O>): void {
  const voice = lane.voice;
  lane.placed = false;
  lane.read = false;
  lane.weighed = false;
  // With no fade in or out the envelope is 1 for every subject, which is what it would return.
  lane.flat = !((voice.fade.in ?? 0) > 0) && voice.out === null && voice.owner === null;
  lane.fade = 1;
}

/** One voice's contribution to every subject it plays on. */
export function run<I, O>(this: Lanes<I, O>, lane: Lane<I, O>): void {
  const voice = lane.voice;
  if (voice.state === 'pending' || voice.state === 'done') return;
  if (lane.group !== null) {
    foldLocus(this, lane, lane.group);
    return;
  }
  this.reset(lane);
  if (lane.motion !== undefined && !voice.keeping) {
    runMotion(this, lane, lane.motion);
    return;
  }
  const elapsed = voice.elapsedAt(this.now);
  const duration = voice.duration;
  const passes = voice.passes;
  const list = lane.list;
  for (let p = 0; p < list.length; p++) {
    this.one(lane, p, list[p] as number, elapsed, duration, passes);
    // Its patch just made kept state: no further call this fill, the general path makes them.
    if (voice.keeping) return;
  }
}

/**
 * One subject's contribution from a lane's voice. True where the voice gave the subject a delta,
 * as the general path's `influence` does where it returns one, which is what makes a voice in a
 * locus one of its members for the subject.
 */
export function one<I, O>(
  this: Lanes<I, O>,
  lane: Lane<I, O>,
  p: number,
  slot: number,
  elapsedNow: number,
  duration: number,
  passes: number,
): boolean {
  const host = this.host;
  const voice = lane.voice;
  const data = lane.data;
  const o = p * Row.STRIDE;
  // A probe read this subject from the last fill: keep the weight it read for `weightOf`.
  if (this.per[slot * Per.SLOT + Per.LANE_FILL] === this.fills - 1)
    data[o + Row.PROBED] = data[o + Row.WEIGHT] as number;
  const delay = data[o + Row.DELAY] as number;
  const elapsed = held(voice, elapsedNow - delay);
  if (!(elapsed >= 0)) {
    data[o + Row.WEIGHT] = 0;
    return false;
  }
  if (!lane.placed || !Object.is(elapsed, lane.placedAt)) {
    lane.placed = true;
    lane.placedAt = elapsed;
    lane.phase = phaseAt(elapsed, duration, passes);
    lane.pass = passAt(elapsed, duration, passes);
  }
  const since = data[o + Row.SINCE] as number;
  if (!lane.flat && (!lane.weighed || !Object.is(since, lane.weighedSince))) {
    lane.fade = host.envelope(voice, since);
    lane.weighed = true;
    lane.weighedSince = since;
  }
  let w: number;
  if (typeof voice.spec.weight === 'function') {
    w = this.signalled(
      voice,
      slot,
      lane.records[p] as Subject<unknown>,
      elapsed,
      lane.pass,
      lane.fade,
    );
    if (Number.isNaN(w)) {
      data[o + Row.WEIGHT] = 0;
      return false;
    }
  } else w = weighed(voice.weight, lane.fade, this.parting(voice, slot));
  data[o + Row.WEIGHT] = w;
  if (voice.built !== null) {
    if (!lane.read || !Object.is(elapsed, lane.readAt)) {
      this.readKeyed(voice, lane.phase, lane.delta, lane.scratch);
      lane.read = true;
      lane.readAt = elapsed;
      this.gather(lane, lane.delta);
    }
    if (w > 0) this.fold(lane, slot, w);
    return true;
  }
  const rec = lane.records[p] as Subject<unknown>;
  // The general path makes a voice's first call for a subject, where it first sees it play.
  if (Number.isNaN(rec.probed)) {
    this.late.push(slot);
    return false;
  }
  // A motion patch needs the subject only to number it, so the lookup waits until then.
  if (lane.motion !== undefined) {
    move(this, lane, lane.motion, p, slot, rec, elapsed, delay, w);
    return true;
  }
  return this.call(voice, lane.chans, rec, slot, elapsed, lane.phase, lane.pass, delay, w);
}

/**
 * A keys voice's stops at `phase` folded straight into a subject's values, without a delta: what
 * `readKeyed` then `foldDelta` give, through the same segment search and the stock channels' own
 * lerp, which is all a laned keys voice can use.
 */
export function foldKeys<I, O>(
  this: Lanes<I, O>,
  voice: Voice<I, O>,
  chans: readonly Laned[],
  phase: number,
  slot: number,
  w: number,
): void {
  const built = voice.built as NonNullable<Voice<I, O>['built']>;
  const tracks = built.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i] as Track;
    const ch = chans[i] as Laned;
    const found = segment(track, shifted(track, phase, built.duration), undefined);
    if (found === NOTHING) continue;
    if (found === AT) {
      this.foldInto(ch, slot, seg.a, w);
      continue;
    }
    const a = seg.a;
    const b = seg.b;
    const u = seg.eased;
    if (ch.scalar) {
      this.foldInto(
        ch,
        slot,
        (voice.lerps[i] as (a: unknown, b: unknown, u: number) => unknown)(a, b, u),
        w,
      );
      continue;
    }
    // `vec`'s lerp, reading each end past its length as the rest, then its fold.
    const as = a as ArrayLike<number>;
    const bs = b as ArrayLike<number>;
    const values = ch.values;
    const base = slot * ch.axes;
    const rest = ch.rest;
    for (let x = 0; x < ch.axes; x++) {
      const v = lerpNumber(as[x] ?? rest, bs[x] ?? rest, u);
      values[base + x] = foldNumber(ch.op, values[base + x] as number, v, w);
    }
  }
}

/** Reads a keys voice's stops at `phase` into `delta`, interpolating into the reader's `scratch`. */
export function readKeyed<I, O>(
  this: Lanes<I, O>,
  voice: Voice<I, O>,
  phase: number,
  delta: Record<string, unknown>,
  scratch: Scratch,
): void {
  readKeys(
    voice.built as NonNullable<Voice<I, O>['built']>,
    phase,
    delta,
    undefined,
    voice.lerps as never,
    undefined,
    voice.intos,
    scratch,
  );
}

/**
 * Calls a stateless fn voice's patch for a subject its general path has met, and folds the delta;
 * false for a subject the host has let go of.
 */
export function call<I, O>(
  this: Lanes<I, O>,
  voice: Voice<I, O>,
  chans: readonly Laned[],
  rec: Subject<unknown>,
  slot: number,
  elapsed: number,
  phase: number,
  pass: number,
  delay: number,
  w: number,
): boolean {
  const host = this.host;
  const subject = this.subjectAt(slot);
  if (subject === absent) return false;
  // Called already this frame, by the general path or a fill before a refill: reuse, as a probe does.
  if (rec.probed === this.now && rec.delta !== null && rec.seeks === voice.seeks) {
    if (w > 0) this.foldDelta(chans, slot, rec.delta, w);
    return true;
  }
  if (silent(voice, w)) return true;
  const kept = reading.kept;
  host.ready(voice, subject, rec, elapsed, pass, w);
  if (this.keeps) host.horizon(voice, delay);
  else reading.horizon = Number.POSITIVE_INFINITY;
  const delta = voice.patch.at(phase, subject, voice.setting as never) as Record<string, unknown>;
  // What `influence` leaves on the record, so a probe on the general path this frame reuses it.
  rec.delta = delta;
  rec.probed = this.now;
  rec.seeks = voice.seeks;
  if (this.keeps) host.after(voice, rec);
  if (reading.kept !== kept && !voice.keeping) host.kept(voice);
  if (w > 0) this.foldDelta(chans, slot, delta, w);
  return true;
}
