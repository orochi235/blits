import { foldNumber, lerpNumber } from './channels.js';
import { passAt, phaseAt, same, silent, weighed } from './clock.js';
import { flush } from './columns.js';
import { crowdsUpTo, freshen } from './crowd.js';
import { foldLocus, gatherLocus } from './gather.js';
import { runKeys } from './keyfill.js';
import { Arg, frozenAt, type Lane, type Laned, type Paced, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import { reach } from './meet.js';
import { absent } from './numbers.js';
import { AT, NOTHING, readKeys, type Scratch, seg, segment, shifted, type Track } from './patch.js';
import { reading } from './reading.js';
import { move, runMotion } from './sample.js';
import type { Subject, Voice } from './voice.js';

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
    lanes.lately = share < 1 ? lanes.lastFrom : -1;
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
      for (const c of lanes.crowds)
        if (!c.idle) {
          c.bareFill = lanes.fills;
          c.bareNow = now;
        }
    }
    // With every lane idle there was nothing to fill, and no subject reads a lane this frame.
    lanes.busyFill = busy ? lanes.fills : 0;
    for (const slot of lanes.late) lanes.per[slot * Per.SLOT + Per.FILLED] = lanes.fills;
    if (lanes.holding) {
      lanes.subjects.fill(undefined, 0, size);
      lanes.holding = false;
    }
    lanes.moved = reading.moved;
    lanes.inputs = reading.inputs;
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
 * A voice with a signal weight: its weight for the subject at `slot`, left in `Arg.WEIGHT`, at the
 * voice time, pass and fade in `Arg.ELAPSED`, `Arg.PASS` and `Arg.FADE`, through the general path's
 * own arithmetic. False where that path has not made the voice's first call for the subject, which
 * it then makes this frame, so a signal that keeps state is first called where the general path
 * would call it.
 */
export function signalled<I, O>(
  this: Lanes<I, O>,
  voice: Voice<I, O>,
  slot: number,
  rec: Subject<unknown>,
): boolean {
  const arg = this.arg;
  const elapsed = arg[Arg.ELAPSED] as number;
  const pass = arg[Arg.PASS] as number;
  const fade = arg[Arg.FADE] as number;
  if (Number.isNaN(rec.probed)) {
    this.late.push(slot);
    return false;
  }
  const subject = this.subjectAt(slot);
  if (subject === absent) {
    arg[Arg.WEIGHT] = 0;
    return true;
  }
  const base = this.host.signal(voice, subject, rec, elapsed, pass, slot);
  arg[Arg.WEIGHT] = weighed(
    base,
    fade,
    voice.parts === null ? 1 : this.host.parting(voice, subject),
  );
  return true;
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
  lane.flat =
    !((voice.fade.in ?? 0) > 0) &&
    voice.out === null &&
    voice.back === null &&
    voice.owner === null;
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
  if (voice.built !== null && typeof voice.spec.weight !== 'function') {
    runKeys(this, lane);
    return;
  }
  lane.elapsedNow = voice.elapsedAt(this.now);
  const list = lane.list;
  for (let p = 0; p < list.length; p++) {
    this.one(lane, p, list[p] as number);
    // Its patch just made kept state: no further call this fill, the general path makes them.
    if (voice.keeping) return;
  }
}

/**
 * One subject's contribution from a lane's voice. True where the voice gave the subject a delta,
 * as the general path's `contribution` does where it returns one, which is what makes a voice in a
 * locus one of its members for the subject.
 */
export function one<I, O>(this: Lanes<I, O>, lane: Lane<I, O>, p: number, slot: number): boolean {
  const host = this.host;
  const voice = lane.voice;
  const elapsedNow = lane.elapsedNow;
  const arg = this.arg;
  const data = lane.data;
  const o = p * Row.STRIDE;
  // A probe read this subject from the last fill: keep the weight it read for `weightOf`.
  if (this.per[slot * Per.SLOT + Per.LANE_FILL] === this.fills - 1)
    data[o + Row.PROBED] = data[o + Row.WEIGHT] as number;
  if (this.lately >= 0 && this.unread(slot)) return false;
  const delay = data[o + Row.DELAY] as number;
  const elapsed = frozenAt(voice, elapsedNow - delay);
  if (!(elapsed >= 0)) {
    data[o + Row.WEIGHT] = 0;
    return false;
  }
  if (!lane.placed || !same(elapsed, lane.placedAt)) {
    lane.placed = true;
    lane.placedAt = elapsed;
    lane.phase = phaseAt(elapsed, voice.duration, voice.passes);
    lane.pass = passAt(elapsed, voice.duration, voice.passes);
  }
  const since = data[o + Row.SINCE] as number;
  if (!lane.flat && (!lane.weighed || !same(since, lane.weighedSince))) {
    lane.fade = host.envelope(voice, since);
    lane.weighed = true;
    lane.weighedSince = since;
  }
  let w: number;
  if (typeof voice.spec.weight === 'function') {
    arg[Arg.ELAPSED] = elapsed;
    arg[Arg.PASS] = lane.pass;
    arg[Arg.FADE] = lane.fade;
    if (!this.signalled(voice, slot, lane.records[p] as Subject<unknown>)) {
      data[o + Row.WEIGHT] = 0;
      return false;
    }
    w = arg[Arg.WEIGHT] as number;
  } else w = weighed(voice.weight, lane.fade, this.parting(voice, slot));
  data[o + Row.WEIGHT] = w;
  this.folding = lane;
  this.rec = lane.records[p] ?? null;
  if (voice.built !== null) {
    if (!lane.read || !same(elapsed, lane.readAt)) {
      this.readKeyed(voice, lane.phase, lane.delta, lane.scratch);
      lane.read = true;
      lane.readAt = elapsed;
      this.gather(lane, lane.delta);
    }
    if (w > 0) {
      arg[Arg.WEIGHT] = w;
      this.fold(lane, slot);
    }
    return true;
  }
  const rec = lane.records[p] as Subject<unknown>;
  // The general path makes a voice's first call for a subject, where it first sees it play.
  if (Number.isNaN(rec.probed)) {
    this.late.push(slot);
    return false;
  }
  // A motion patch needs the subject only to number it, so the lookup waits until then.
  arg[Arg.ELAPSED] = elapsed;
  arg[Arg.DELAY] = delay;
  arg[Arg.WEIGHT] = w;
  if (lane.motion !== undefined) {
    move(this, lane, lane.motion, p, slot, rec);
    return true;
  }
  arg[Arg.PHASE] = lane.phase;
  arg[Arg.PASS] = lane.pass;
  return this.call(voice, lane.chans, rec, slot);
}

/**
 * A keys voice's stops at `Arg.PHASE` folded straight into a subject's values at `Arg.WEIGHT`,
 * without a delta: what `readKeyed` then `foldDelta` give, through the same segment search and the
 * stock channels' own lerp, which is all a laned keys voice can use.
 */
export function foldKeys<I, O>(
  this: Lanes<I, O>,
  voice: Voice<I, O>,
  chans: readonly Laned[],
  slot: number,
): void {
  const phase = this.arg[Arg.PHASE] as number;
  const w = this.arg[Arg.WEIGHT] as number;
  const built = voice.built as NonNullable<Voice<I, O>['built']>;
  const tracks = built.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i] as Track;
    const ch = chans[i] as Laned;
    const found = segment(track, shifted(track, phase, built.duration), undefined);
    if (found === NOTHING) continue;
    if (found === AT) {
      this.foldInto(ch, slot, seg.a);
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
 * Calls a stateless fn voice's patch for a subject its general path has met, and folds the delta,
 * at the voice time, phase, pass, delay and weight in `Arg`; false for a subject the host has let
 * go of. As arguments those cost nothing where V8 inlines the call and 31 bytes a call where it
 * does not, which differs by V8 version: Node 26.1 does not (2026-10-09).
 */
export function call<I, O>(
  this: Lanes<I, O>,
  voice: Voice<I, O>,
  chans: readonly Laned[],
  rec: Subject<unknown>,
  slot: number,
): boolean {
  const arg = this.arg;
  const elapsed = arg[Arg.ELAPSED] as number;
  const phase = arg[Arg.PHASE] as number;
  const pass = arg[Arg.PASS] as number;
  const delay = arg[Arg.DELAY] as number;
  const w = arg[Arg.WEIGHT] as number;
  const host = this.host;
  const subject = this.subjectAt(slot);
  if (subject === absent) return false;
  // Called already this frame, by the general path or a fill before a refill: reuse, as a probe does.
  if (
    rec.probed === this.now &&
    rec.delta !== null &&
    rec.seeks === voice.seeks &&
    (rec !== voice.everyone || voice.sharedFor === subject)
  ) {
    if (w > 0) this.foldDelta(chans, slot, rec.delta);
    return true;
  }
  if (silent(voice, w)) return true;
  const kept = reading.kept;
  host.ready(voice, subject, rec, elapsed, pass, w);
  if (this.keeps) host.horizon(voice, delay);
  else reading.horizon = Number.POSITIVE_INFINITY;
  const delta = voice.patch.at(phase, subject, voice.setting as never) as Record<string, unknown>;
  // What `contribution` leaves on the record, so a probe on the general path this frame reuses it.
  rec.delta = delta;
  rec.probed = this.now;
  rec.seeks = voice.seeks;
  if (rec === voice.everyone) voice.sharedFor = subject;
  if (this.keeps) host.after(voice, subject, rec);
  if (reading.kept !== kept && !voice.keeping) host.kept(voice);
  if (w > 0) this.foldDelta(chans, slot, delta);
  return true;
}
