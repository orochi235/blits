import { inBound } from './bound.js';
import { passAt, phaseAt, phaseBefore, silent, stepOf } from './clock.js';
import { copy as copyValue } from './clone.js';
import { type Key, near } from './fold.js';
import { waits } from './held.js';
import { apart, copyState, recordHost, remember } from './history.js';
import { stateful } from './hosts.js';
import type { Mixer } from './mixer.js';
import { moved } from './moved.js';
import { type Built, readKeys } from './patch.js';
import { reading } from './reading.js';
import { isRested } from './record.js';
import type { Subject } from './subject.js';
import type { Channel, Patch } from './types.js';
import { checkWrites, type Voice } from './voice.js';
import { Primed } from './weigh.js';

// V8 reads a local const as a constant, where it reads an import from its module on every call.
const copy = copyValue;

/**
 * A record after a seek that rebuilds: fresh state, stepped again from where the voice's clock now
 * puts this subject's start, which under `stepMs` lands where a voice cued fresh would.
 */
function rebuild<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  held: Subject<unknown>,
): void {
  held.rebuilt = voice.rebuilds;
  const patch = voice.patch;
  if (patch.state === undefined && patch.step === undefined && held.kept === null) return;
  held.state = patch.state ? (patch.state(subject) as unknown) : undefined;
  held.kept = null;
  held.unkept = undefined;
  held.since = mix.sinceOf(voice, held.delay);
  held.shown = mix.shownOf(voice, held.since);
  held.ticks = 0;
  held.stepped = held.since < now ? held.since : now;
  held.probed = Number.NaN;
}

/** Whether a seek since its last read moved a stateful record's origin, as one back before it does. */
function sentBack<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, held: Subject<unknown>): boolean {
  const p = voice.patch;
  if (p.state === undefined && p.step === undefined && !voice.keeping) return false;
  return mix.sinceOf(voice, held.delay) !== held.since;
}

/** The phase `elapsed` voice ms puts a voice at, before its start included. */
function phaseOf(elapsed: number, duration: number, passes: number): number {
  return elapsed < 0 ? phaseBefore(elapsed, duration) : phaseAt(elapsed, duration, passes);
}

/**
 * One live voice's delta for one subject this frame, through its record for the subject, or null
 * when it does not reach. Its weight is left in `w`.
 */
export function contribution<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  held: Subject<unknown>,
): Record<string, unknown> | null {
  held.weight = 0;
  if (!held.reaches) return null;
  if (voice.bound !== null && !inBound(this, voice.bound, subject)) return null;
  if (voice.out?.rest && isRested(held)) return null;
  if (held.rebuilt !== voice.rebuilds) rebuild(this, voice, subject, now, held);
  else if (held.seeks !== voice.seeks && sentBack(this, voice, held)) {
    // A seek sent it back before its start, so it starts afresh there, whatever state it kept.
    rebuild(this, voice, subject, now, held);
    waits(voice, held, now);
  }

  const raw = voice.rawAt(now, held.delay);
  const early = voice.before(raw, now);
  if (early && !voice.holdsFirst) return null;
  const elapsed = voice.shownAt(raw);
  if (Number.isNaN(elapsed)) return null;
  // A frozen subject's clock stands still at the edge it freezes at: -1 before, 1 after, 0 playing.
  const still = early ? -1 : voice.freezesAfter && raw > voice.span ? 1 : 0;

  const duration = voice.duration;
  const pass = passAt(elapsed, duration, voice.passes);

  const primed = this.primed;
  primed[Primed.NOW] = now;
  primed[Primed.ELAPSED] = elapsed;
  primed[Primed.PASS] = pass;
  this.prime(voice, held);
  const setting = voice.setting;

  // A signal that keeps state makes its voice stateful, as a patch that does: a lane would call
  // it for subjects no probe asked about.
  const keptAtWeigh = reading.kept;
  const weight = this.weigh(voice, subject, now, held);
  if (reading.kept !== keptAtWeigh && !voice.keeping) stateful(this, voice);
  setting.weight = weight;
  held.weight = weight;

  if (held.probed === now && held.delta && held.seeks === voice.seeks) {
    if (voice.holder !== held && voice.scratch.length > 0) this.keyed(voice, subject, held);
    this.w = weight;
    return held.delta;
  }

  const keptBefore = reading.kept;
  const history = this.opts.history;
  if (history?.inputs && voice.patch.reads !== undefined && !this.projecting) recordHost(this, now);
  // Only a motion reads it.
  if (voice.motion !== undefined) reading.horizon = this.horizonFor(voice, held.delay, now);

  if (voice.patch.step && held.probed !== now) {
    // Frozen after, it steps once more to where its last pass ended, and no further; run back
    // past its start, to where it reached it. Before a start it has yet to reach, it does not step.
    const to =
      still === 0
        ? now
        : still === 1
          ? voice.timeAt(held.delay + voice.span)
          : voice.ranBackTo(held.delay, now);
    // Never probed, it may be a record a seek put back, sharing its copy's state until it steps.
    const snaps = held.snaps;
    const sought = Number.isNaN(held.probed) && snaps !== undefined;
    if (!Number.isNaN(to)) {
      if (held.stepped < held.since) {
        held.stepped = held.since;
        setting.dt = this.capped(now - held.since);
      }
      const tick = stepOf(this, voice);
      if (tick !== undefined && sought) ahead(this, voice, subject, held, snaps, tick, to);
      if (sought) own(voice, held);
      if (tick !== undefined) this.tick(voice, subject, held, tick, to);
      else if (still === 0 ? now !== held.stepped : to > held.stepped) {
        if (still !== 0) setting.dt = this.capped(to - held.stepped);
        voice.patch.step(held.state as never, setting.dt, subject, setting as never);
        held.stepped = to;
      }
    } else if (sought) own(voice, held);
  }

  let delta: Record<string, unknown> | null = null;
  // A keys voice in a role reads at weight 0 too: having a delta makes it a member, and the
  // role folds at its first member's place.
  if (silent(voice, weight) && (voice.built === null || voice.spec.role === undefined)) {
    // A `from: 'current'` voice takes its base on its first read, silent or not.
    if (voice.built && voice.spec.from === 'current' && held.base === undefined) {
      held.base = this.baseFor(voice, subject);
      held.slope = this.slopeFor(voice, subject);
    }
  } else if (voice.built) {
    held.phase = phaseOf(elapsed, duration, voice.passes);
    delta = this.keyed(voice, subject, held);
  } else if (voice.motion !== undefined) {
    delta = moved(voice.motion, voice.patch.writes[0] as string, subject, setting, held);
  } else {
    const phase = phaseOf(elapsed, duration, voice.passes);
    delta = voice.patch.at(phase, subject, setting as never) as Record<string, unknown>;
    if (voice.unchecked) checkWrites(voice, delta);
  }
  held.delta = delta;
  held.probed = now;
  held.seeks = voice.seeks;
  if (history !== undefined) remember(this, voice, subject, held);
  if (reading.kept !== keptBefore && !voice.keeping) stateful(this, voice);
  if (delta === null) return null;

  if (voice.out?.rest && this.isRest(delta)) {
    held.weight = 0;
    held.restedAt = now;
    voice.restedCount++;
    return null;
  }
  this.w = weight;
  return delta;
}

/** Reads a keys voice's stops at `held.phase` into the subject's delta, through the voice's scratch. */
export function keyed<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown>,
): Record<string, unknown> {
  let base: Record<string, unknown> | undefined;
  if (voice.spec.from === 'current') {
    if (held.base === undefined) {
      held.base = this.baseFor(voice, subject);
      held.slope = this.slopeFor(voice, subject);
    }
    base = held.base;
  }
  const delta = readKeys(
    voice.built as Built,
    held.phase,
    held.delta ?? {},
    base,
    voice.lerps as never,
    held.slope,
    voice.intos,
    voice.scratch,
  );
  held.delta = delta;
  if (voice.scratch.length > 0) voice.holder = held;
  return delta;
}

/** How many whole intervals of `tick` a subject's step grid holds by mix time `to`. */
function dueBy(held: Subject<unknown>, tick: number, to: number): number {
  // The epsilon keeps an interval like 1000 / 120 from landing a hair short of a whole count.
  return Math.floor((to - held.since) / tick + 1e-9);
}

/**
 * The first step of a record a seek put back from a copy: takes up the furthest state stepped on
 * from that copy that the steps due now run past, the one the record the seek replaced reached or
 * the one the copy was last stepped ahead to, and otherwise keeps the copy's stepped ahead to the
 * moment sought, so a mix sought back time after time does not step from the copy each time, nor a
 * mix sought back and returned step again to where it was. Only where the same steps give the same
 * state: a fixed interval, no `maxDt`, no host field read.
 */
function ahead<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown>,
  snaps: NonNullable<Subject<unknown>['snaps']>,
  tick: number,
  to: number,
): void {
  const from = snaps[snaps.length - 1];
  const got = from?.ahead;
  if (from === undefined || got === undefined || got.put !== held) return;
  got.put = null;
  const reads = voice.patch.reads;
  if (mix.opts.maxDt !== undefined || (reads !== undefined && reads.length > 0)) return;
  // Stepped, rebuilt or placed anew since it was put back, its steps are no longer the copy's.
  const was = from.held;
  if (held.ticks !== was.ticks || held.since !== got.since || held.rebuilt !== was.rebuilt) return;
  const at = got.sought;
  const due = dueBy(held, tick, to);
  const usable = got.state !== undefined && got.ticks <= due;
  if (got.left !== undefined && got.leftTicks <= due && !(usable && got.ticks > got.leftTicks)) {
    // Taken, not copied: the next seek back keeps the state this record steps on to in its place.
    held.state = got.left;
    got.left = undefined;
    voice.setting.state = held.state;
    held.ticks = got.leftTicks;
    return;
  }
  if (usable) {
    held.state = copyState(voice, got.state);
    voice.setting.state = held.state;
    held.ticks = got.ticks;
  }
  const last = usable ? got.at : from.at;
  if (!(at < to) || at - last < apart(mix.opts.history as { every?: number })) return;
  own(voice, held);
  mix.tick(voice, subject, held, tick, at);
  got.state = copyState(voice, held.state);
  got.ticks = held.ticks;
  got.at = at;
}

/**
 * A record a seek put back shares the state of the copy it was made from, which no read changes,
 * until its first probe: before it steps, it takes a copy of its own.
 */
function own<I, O>(voice: Voice<I, O>, held: Subject<unknown>): void {
  const snaps = held.snaps as NonNullable<Subject<unknown>['snaps']>;
  const from = snaps[snaps.length - 1];
  if (from !== undefined && held.state !== undefined && held.state === from.held.state) {
    held.state = copyState(voice, held.state);
    voice.setting.state = held.state;
  }
}

/**
 * Runs `step` once per whole interval between where this subject last stopped and now, on a grid
 * counted from when its delay ran out, and leaves the remainder for the next sample. Counting
 * rather than adding keeps the grid where it is however many samples it is reached through.
 */
export function tick<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  held: Subject<unknown>,
  tick: number,
  to: number,
): void {
  const now = this.now;
  const setting = voice.setting;
  const frameDt = setting.dt;
  let n = held.ticks;
  const due = dueBy(held, tick, to);
  const cap = this.opts.maxDt;
  if (cap !== undefined) {
    const most = Math.floor(cap / tick);
    if (due - n > most) n = due - most;
  }
  const step = voice.patch.step as NonNullable<Patch<I, O, unknown>['step']>;
  setting.dt = tick;
  for (n++; n <= due; n++) {
    setting.timestamp = held.since + n * tick;
    step(held.state as never, tick, subject, setting as never);
  }
  held.ticks = due > held.ticks ? due : held.ticks;
  held.stepped = held.since + held.ticks * tick;
  setting.timestamp = now;
  setting.dt = frameDt;
}

/**
 * Stop 0 for a retargeting voice: the subject's pose in the frame before this voice contributes.
 * With no such frame on record — a voice cued before the subject was ever probed, or a host that
 * samples into its own object — it is this frame's pose with every other voice folded in.
 */
export function baseFor<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
): Record<string, unknown> {
  let prior = this.pose.get(subject)?.pose as Record<string, unknown> | undefined;
  if (prior === undefined && !this.folding.has(voice.id)) {
    this.folding.add(voice.id);
    try {
      prior = this.fold(subject, undefined, false, voice.id) as Record<string, unknown>;
    } finally {
      this.folding.delete(voice.id);
    }
  }
  const base: Record<string, unknown> = {};
  for (const key of voice.patch.writes as Key<O>[]) {
    const channel = this.kit[key] as Channel<unknown>;
    const value = prior?.[key];
    const fallback = channel.rest;
    if (value !== undefined) base[key] = copy(value);
    else if (fallback !== undefined) base[key] = copy(fallback);
  }
  return base;
}

/**
 * How fast each numeric channel this voice writes was moving, from the subject's last two probed
 * poses, in units per ms. Undefined with fewer than two on record, which starts the voice at rest.
 */
export function slopeFor<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
): Record<string, unknown> | undefined {
  const rec = this.pose.get(subject);
  if (rec?.prev === undefined || !(rec.at > rec.prevAt)) return undefined;
  const dt = rec.at - rec.prevAt;
  const now = rec.pose as Record<string, unknown>;
  const before = rec.prev as Record<string, unknown>;
  const slope: Record<string, unknown> = {};
  for (const key of voice.patch.writes as Key<O>[]) {
    const a = before[key];
    const b = now[key];
    if (typeof a === 'number' && typeof b === 'number') slope[key] = (b - a) / dt;
    else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
      slope[key] = b.map((v, i) => ((v as number) - (a[i] as number)) / dt);
  }
  return slope;
}

export function isRest<I, O>(this: Mixer<I, O>, delta: Record<string, unknown>): boolean {
  for (const key of Object.keys(delta) as Key<O>[]) {
    if (delta[key] === undefined) continue;
    const channel = this.kit[key] as Channel<unknown>;
    if (channel.rest === undefined) return false;
    if (!near(delta[key], channel.rest)) return false;
  }
  return true;
}

/** `contribution`, or for a dry fold a subject already probed this frame, without advancing it. */
export function read<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  now: number,
  dry: boolean,
  held: Subject<unknown>,
): Record<string, unknown> | null {
  if (dry) {
    if (held.reaches && held.probed === now && held.delta && held.seeks === voice.seeks) {
      const setting = voice.setting;
      // The setting the probe that read the delta had, but for `dt`: a dry read advances nothing.
      const elapsed = voice.shownAt(voice.rawAt(now, held.delay));
      setting.timestamp = now;
      setting.dt = 0;
      setting.elapsed = elapsed;
      setting.pass = passAt(elapsed, voice.duration, voice.passes);
      setting.weight = 0;
      setting.state = held.state;
      setting.mark = 0;
      voice.keepOn = held;
      this.w = this.weigh(voice, subject, now, held);
      held.weight = this.w;
      if (voice.holder !== held && voice.scratch.length > 0) this.keyed(voice, subject, held);
      return held.delta;
    }
  }
  return this.contribution(voice, subject, now, held);
}
