import { frozenTime, passAt, phaseAt, silent } from './clock.js';
import { copy as copyValue } from './clone.js';
import { recordHost, remember } from './history.js';
import { stateful } from './hosts.js';
import type { Lanes } from './lanes.js';
import { locusScratch } from './locus.js';
import type { Mixer } from './mixer.js';
import { moved } from './moved.js';
import { type Built, readKeys } from './patch.js';
import { reading } from './reading.js';
import type { Channel, Patch, Setting } from './types.js';
import type { Subject, Voice } from './voice.js';

export type Key<O> = keyof O & string;

// V8 reads a local const as a constant, where it reads an import from its module on every call.
const copy = copyValue;

/** A record's band state, made when a rest-less channel first asks. */
function bandsFor(held: Subject<unknown>, n: number): Uint8Array {
  const bands = new Uint8Array(n);
  held.bands = bands;
  return bands;
}

export function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => near(v, b[i]));
  return a === b;
}

/**
 * `merge(acc, b)`, where a result that is `b` itself, as `last()` gives, is copied into `acc` or a
 * new array: `b` belongs to a patch or the mix's scratch, and a host may edit the pose. `acc` is a
 * value this fold made.
 */
export function merged(channel: Channel<unknown>, acc: unknown, b: unknown): unknown {
  const r = channel.merge(acc, b);
  if (r !== b || !Array.isArray(r)) return r;
  if (!Array.isArray(acc) || acc.length !== r.length) return [...r];
  for (let i = 0; i < r.length; i++) acc[i] = r[i];
  return acc;
}

export type Values = Record<string, unknown>;

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
  if (voice.out?.rest && held.rested) return null;
  if (held.rebuilt !== voice.rebuilds) rebuild(this, voice, subject, now, held);

  const raw = voice.elapsedAt(now) - held.delay;
  // Not `raw < 0`: see `frozenTime` for the clock that reads NaN before its start.
  const early = !(raw >= 0);
  if (early && !voice.freezesBefore) return null;
  const elapsed = frozenTime(raw, voice.freezesBefore, voice.freezesAfter, voice.span);
  // A frozen subject's clock stands still at the edge it freezes at: -1 before, 1 after, 0 playing.
  const still = early ? -1 : voice.freezesAfter && raw > voice.span ? 1 : 0;

  const duration = voice.duration;
  const phase = phaseAt(elapsed, duration, voice.passes);
  const pass = passAt(elapsed, duration, voice.passes);

  this.prime(voice, held, now, elapsed, pass);
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
  reading.horizon = this.horizonFor(voice, held.delay, now);

  const tick = this.opts.stepMs;
  if (voice.patch.step && held.probed !== now && still >= 0) {
    // Frozen after, it steps once more to where its last pass ended, and no further.
    const to = still === 1 ? voice.timeAt(held.delay + voice.span) : now;
    if (held.stepped < held.since) {
      held.stepped = held.since;
      setting.dt = this.capped(now - held.since);
    }
    if (tick !== undefined && tick > 0 && !this.reducedNow)
      this.tick(voice, subject, held, tick, to);
    else if (still === 0 ? now !== held.stepped : to > held.stepped) {
      if (still === 1) setting.dt = this.capped(to - held.stepped);
      voice.patch.step(held.state as never, setting.dt, subject, setting as Setting<never>);
      held.stepped = to;
    }
  }

  let delta: Record<string, unknown> | null = null;
  // A keys voice in a locus reads at weight 0 too: having a delta makes it a member, and the
  // locus folds at its first member's place.
  if (silent(voice, weight) && (voice.built === null || voice.spec.locus === undefined)) {
    // A `from: 'current'` voice takes its base on its first read, silent or not.
    if (voice.built && voice.spec.from === 'current' && held.base === undefined) {
      held.base = this.baseFor(voice, subject);
      held.slope = this.slopeFor(voice, subject);
    }
  } else if (voice.built) {
    held.phase = phase;
    delta = this.keyed(voice, subject, held);
  } else if (voice.motion !== undefined) {
    delta = moved(voice.motion, voice.patch.writes[0] as string, subject, setting, held.delta);
  } else {
    delta = voice.patch.at(phase, subject, setting as Setting<never>) as Record<string, unknown>;
  }
  held.delta = delta;
  held.probed = now;
  held.seeks = voice.seeks;
  if (history !== undefined) remember(this, voice, subject, held);
  if (reading.kept !== keptBefore && !voice.keeping) stateful(this, voice);
  if (delta === null) return null;

  if (voice.out?.rest && this.isRest(delta)) {
    held.weight = 0;
    held.rested = true;
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
  // The epsilon keeps an interval like 1000 / 120 from landing a hair short of a whole count.
  const due = Math.floor((to - held.since) / tick + 1e-9);
  const cap = this.opts.maxDt;
  if (cap !== undefined) {
    const most = Math.floor(cap / tick);
    if (due - n > most) n = due - most;
  }
  const step = voice.patch.step as NonNullable<Patch<I, O, unknown>['step']>;
  setting.dt = tick;
  for (n++; n <= due; n++) {
    setting.timestamp = held.since + n * tick;
    step(held.state as never, tick, subject, setting as Setting<never>);
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

/**
 * A record's band state once its voice is skipped at weight 0: off, as `passes` would have said, so
 * a weight that comes back inside the band does not find it still on.
 */
export function unband(held: Subject<unknown> | null | undefined): void {
  if (held?.bands) held.bands.fill(2);
}

/** Whether a rest-less channel's contribution is switched on, across a band rather than an edge. */
export function passes<I, O>(this: Mixer<I, O>, was: boolean | undefined, w: number): boolean {
  const { on, off } = this.band;
  return w >= on ? true : w <= off ? false : (was ?? w >= on);
}

/** Folds one voice's delta into the pose, its band state kept on the subject's record. */
export function apply<I, O>(
  this: Mixer<I, O>,
  pose: Record<string, unknown>,
  voice: Voice<I, O>,
  held: Subject<unknown>,
  delta: Record<string, unknown>,
  weight: number,
): void {
  const slots = voice.slots;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as number;
    const key = this.names[slot] as string;
    const value = delta[key];
    if (value === undefined) continue;
    const channel = this.channels[slot] as Channel<unknown>;
    if (channel.rest !== undefined && channel.scale) {
      // pose[key] is the copy of rest this fold made, so it is ours to write into.
      pose[key] = channel.fold
        ? channel.fold(pose[key], value, weight)
        : merged(channel, pose[key], channel.scale(value, weight));
      continue;
    }
    const bands = held.bands ?? bandsFor(held, slots.length);
    const band = bands[i];
    const on = this.passes(band === 0 ? undefined : band === 1, weight);
    bands[i] = on ? 1 : 2;
    if (on) pose[key] = pose[key] === undefined ? copy(value) : merged(channel, pose[key], value);
  }
}

/** Clamps every bounded channel of a folded pose into its range, in place. */
export function clamp<I, O>(
  this: Mixer<I, O>,
  pose: Record<string, unknown>,
): Record<string, unknown> {
  for (const slot of this.bounded) {
    const key = this.names[slot] as string;
    pose[key] = bound(this.channels[slot] as Channel<unknown>, pose[key]);
  }
  return pose;
}

/** A folded value held to its channel's bounds: a number clamped, an array clamped in place. */
export function bound(channel: Channel<unknown>, v: unknown): unknown {
  const [lo, hi] = channel.bounds as readonly [number, number];
  if (typeof v === 'number') return v < lo ? lo : v > hi ? hi : v;
  if (Array.isArray(v))
    for (let i = 0; i < v.length; i++) {
      const x = v[i] as number;
      v[i] = x < lo ? lo : x > hi ? hi : x;
    }
  return v;
}

export function fold<I, O>(
  this: Mixer<I, O>,
  subject: I,
  out?: O,
  dry = false,
  except?: number,
): O {
  const pose = this.folded(subject, out, dry, except) as Record<string, unknown>;
  return (this.bounded.length === 0 ? pose : this.clamp(pose)) as O;
}

export function folded<I, O>(
  this: Mixer<I, O>,
  subject: I,
  out?: O,
  dry = false,
  except?: number,
): O {
  const head = this.linked(subject);
  return this.foldWith(subject, out ?? ({} as O), head, this.linkedLaned, dry, except);
}

/**
 * A subject's chain, linked for this frame, and in `linkedLaned` whether its lanes answer for the
 * voices on them; a subject numbered since the frame's fill folds every voice, laned ones included.
 */
export function linked<I, O>(this: Mixer<I, O>, subject: I): Subject<unknown> | null {
  const head = Number.isNaN(this.now) ? null : this.chain(subject);
  this.linkedLaned =
    head !== null && this.lanes?.prepare(head.slot, subject, this.version, head) === true;
  return head;
}

/** The fold after a subject's chain is linked and its lanes asked whether it reads from them. */
export function foldWith<I, O>(
  this: Mixer<I, O>,
  subject: I,
  out: O,
  head: Subject<unknown> | null,
  laned: boolean,
  dry: boolean,
  except?: number,
): O {
  const now = this.now;
  const pose = out as Record<string, unknown>;
  const lanes = this.lanes;
  const skip = laned ? (lanes as Lanes<I, O>).copies : null;
  for (let i = 0; i < this.names.length; i++) {
    if (skip?.[i]) continue;
    const channel = this.channels[i] as Channel<unknown>;
    const rest = channel.rest;
    const key = this.names[i] as string;
    // Never `delete`: it drops a reused out object into dictionary mode for good.
    if (rest === undefined) {
      if (pose[key] !== undefined) pose[key] = undefined;
      continue;
    }
    // A stock array channel never keeps the pose's array, so one a last fold left in `out` is ours.
    const held = this.lerpsInto[i] === undefined ? undefined : pose[key];
    if (Array.isArray(held) && held !== rest && held.length === (rest as unknown[]).length) {
      for (let a = 0; a < held.length; a++) held[a] = (rest as unknown[])[a];
    } else pose[key] = channel.copy ? channel.copy(rest) : copy(rest);
  }
  if (head === null) return pose as O;
  // A subject owing lanes it just met folds those voices here, after the lanes' values.
  let owed = -1;
  if (laned) {
    const l = lanes as Lanes<I, O>;
    l.copy(head.slot, pose);
    if (l.owes(head.slot)) owed = head.slot;
    else if (l.whole) return pose as O;
  }
  if (this.loci === 0) {
    for (let held: Subject<unknown> | null = head; held !== null; held = held.next) {
      const voice = held.voice as Voice<I, O> | null;
      if (voice === null || (laned && voice.laned && !this.owedBy(owed, voice))) continue;
      if (voice.id === except || voice.state === 'done') continue;
      const delta = this.read(voice, subject, now, dry, held);
      if (owed >= 0 && voice.laned) (lanes as Lanes<I, O>).paid(voice.id, owed, held.weight);
      if (!(held.weight > 0)) unband(held);
      if (delta === null || this.w <= 0) continue;
      this.apply(pose, voice, held, delta, this.w);
    }
    return pose as O;
  }
  return this.foldLoci(subject, pose, head, laned, dry, except, owed);
}

/** Whether the subject numbered `owed` reads laned `voice` from the general path this fill. */
export function owedBy<I, O>(this: Mixer<I, O>, owed: number, voice: Voice<I, O>): boolean {
  return owed >= 0 && (this.lanes as Lanes<I, O>).owesVoice(owed, voice.id);
}

/** `foldWith`'s voices with a locus in play: each locus folds at its first member's place. */
export function foldLoci<I, O>(
  this: Mixer<I, O>,
  subject: I,
  pose: Record<string, unknown>,
  head: Subject<unknown>,
  laned: boolean,
  dry: boolean,
  except: number | undefined,
  owed: number,
): O {
  const now = this.now;
  // A patch reading the pose can fold again from inside this one, so each depth has its own.
  let k = this.locusScratch[this.locusDepth];
  if (k === undefined) {
    k = locusScratch<I, O>(this.channels.length);
    this.locusScratch[this.locusDepth] = k;
  }
  this.locusDepth++;
  try {
    k.n = 0;
    k.m = 0;
    k.names.length = 0;
    for (let held: Subject<unknown> | null = head; held !== null; held = held.next) {
      const voice = held.voice as Voice<I, O> | null;
      if (voice === null || (laned && voice.laned && !this.owedBy(owed, voice))) continue;
      if (voice.id === except || voice.state === 'done') continue;
      const delta = this.read(voice, subject, now, dry, held);
      if (owed >= 0 && voice.laned) (this.lanes as Lanes<I, O>).paid(voice.id, owed, held.weight);
      if (delta === null) continue;
      const locus = voice.spec.locus;
      let group = -1;
      if (locus !== undefined) {
        group = k.names.indexOf(locus);
        const m = k.m++;
        k.mVoices[m] = voice;
        k.mDeltas[m] = delta;
        k.mWeights[m] = this.w;
        if (group >= 0) {
          k.mGroups[m] = group;
          continue;
        }
        group = k.names.length;
        k.names.push(locus);
        k.mGroups[m] = group;
      }
      const n = k.n++;
      k.voices[n] = voice;
      k.helds[n] = held;
      k.deltas[n] = delta;
      k.weights[n] = locus === undefined ? this.w : 0;
      k.groups[n] = group;
    }

    let bands = head.loci;
    if (bands === null) {
      bands = new Map();
      head.loci = bands;
    }

    for (let n = 0; n < k.n; n++) {
      const group = k.groups[n] as number;
      if (group < 0) {
        const weight = k.weights[n] as number;
        if (weight > 0)
          this.apply(
            pose,
            k.voices[n] as Voice<I, O>,
            k.helds[n] as Subject<unknown>,
            k.deltas[n] as Record<string, unknown>,
            weight,
          );
        else unband(k.helds[n]);
        continue;
      }
      const weight = this.foldLocus(k, group);
      const name = k.names[group] as string;
      if (!(weight > 0)) {
        bands.get(name)?.fill(2);
        continue;
      }
      let on = bands.get(name);
      if (on === undefined) {
        on = new Uint8Array(this.channels.length);
        bands.set(name, on);
      }
      for (let t = 0; t < k.touched.length; t++) {
        const slot = k.touched[t] as number;
        const value = k.values[slot];
        k.values[slot] = undefined;
        const key = this.names[slot] as string;
        const channel = this.channels[slot] as Channel<unknown>;
        // A channel folds at the weight of the members that wrote it, not the whole locus.
        const taken = k.taken[slot] as number;
        const w = taken > 1 ? 1 : taken;
        if (channel.rest !== undefined && channel.scale) {
          // pose[key] is the copy of rest this fold made, so it is ours to write into.
          pose[key] = channel.fold
            ? channel.fold(pose[key], value, w)
            : merged(channel, pose[key], channel.scale(value, w));
          continue;
        }
        const band = on[slot] as number;
        const passes = this.passes(band === 0 ? undefined : band === 1, w);
        on[slot] = passes ? 1 : 2;
        if (passes)
          pose[key] = pose[key] === undefined ? copy(value) : merged(channel, pose[key], value);
      }
    }
    return pose as O;
  } finally {
    for (let n = 0; n < k.n; n++) {
      k.voices[n] = null;
      k.helds[n] = null;
      k.deltas[n] = null;
    }
    for (let m = 0; m < k.m; m++) {
      k.mVoices[m] = null;
      k.mDeltas[m] = null;
    }
    // Left set only where a channel's lerp threw partway, which the next fold must not inherit.
    for (let t = 0; t < k.touched.length; t++) {
      const slot = k.touched[t] as number;
      k.met[slot] = 0;
      k.values[slot] = undefined;
    }
    k.touched.length = 0;
    this.locusDepth--;
  }
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
      const elapsed = frozenTime(
        voice.elapsedAt(now) - held.delay,
        voice.freezesBefore,
        voice.freezesAfter,
        voice.span,
      );
      setting.timestamp = now;
      setting.dt = 0;
      setting.elapsed = elapsed;
      setting.pass = passAt(elapsed, voice.duration, voice.passes);
      setting.weight = 0;
      setting.state = held.state;
      voice.keepOn = held;
      this.w = this.weigh(voice, subject, now, held);
      held.weight = this.w;
      if (voice.holder !== held && voice.scratch.length > 0) this.keyed(voice, subject, held);
      return held.delta;
    }
  }
  return this.contribution(voice, subject, now, held);
}
