import { index } from './chain.js';
import { schedule } from './due.js';
import { copyHeld, last } from './history.js';
import { laneHost } from './hosts.js';
import { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Motions } from './motion.js';
import { move } from './move.js';
import { ownerReading } from './owner.js';
import { Store } from './store.js';
import { hostAt, replay } from './tape.js';
import type { Tape } from './types.js';
import type { Controls, Subject, Voice } from './voice.js';

/**
 * A voice's record of one subject as it stood at mix time `t`, from the latest copy kept by then;
 * undefined for a stateful record first made after `t`, which is met afresh. A stateless record
 * holds nothing that moves with time, so it is copied whenever it was made.
 */
function restore<I, O>(
  voice: Voice<I, O>,
  live: Subject<unknown>,
  t: number,
): Subject<unknown> | undefined {
  const inputs = live.inputs?.filter((e) => e.at <= t);
  const snaps = live.snaps;
  if (snaps === undefined) {
    // Nothing a step or `setting.keep` holds: what it keeps does not move with time.
    const h = copyHeld(voice, live);
    if (h.stepped > t) h.stepped = t;
    // Whether it had rested by `t` is not kept; the next probe finds it again.
    h.rested = false;
    h.inputs = inputs;
    return h;
  }
  const snap = last(snaps, t, true);
  if (snap === undefined) return undefined;
  const h = copyHeld(voice, snap.held);
  h.snaps = snaps.slice(0, snaps.indexOf(snap) + 1);
  h.inputs = inputs;
  return h;
}

/**
 * A voice's records after a rewind: each subject's is put back from the records it had, the first
 * time it is asked for, since the subjects a store holds cannot be listed.
 */
class Restored<I> extends Store<I, Subject<unknown>> {
  constructor(
    private readonly was: Store<I, Subject<unknown>>,
    private readonly make: (live: Subject<unknown>) => Subject<unknown> | undefined,
  ) {
    super();
  }

  override get(key: I): Subject<unknown> | undefined {
    const v = super.get(key);
    if (v !== undefined) return v;
    const live = this.was.get(key);
    if (live === undefined) return undefined;
    this.was.delete(key);
    const made = this.make(live);
    if (made !== undefined) super.set(key, made);
    return made;
  }

  override delete(key: I): void {
    super.delete(key);
    this.was.delete(key);
  }
}

/** Takes a voice cued after the moment sought out of the mix, until the tape cues it again. */
function park<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const owner = voice.owner;
  if (owner?.holding) {
    owner.holding.kids--;
    if (voice.passed) owner.holding.played--;
  }
  const motion = voice.motion;
  if (motion !== undefined && motion.owner === mix.owner && motion.ownerId === voice.id)
    motion.owner = null;
  voice.park();
}

/** Puts a voice's controls and records back as they stood at mix time `t`. */
function restoreVoice<I, O>(voice: Voice<I, O>, t: number): void {
  const log = voice.log as Controls[];
  const c = last(log, t, true) ?? (log[0] as Controls);
  log.length = log.indexOf(c) + 1;
  voice.anchorNow = c.anchorNow;
  voice.anchorElapsed = c.anchorElapsed;
  voice.rate = c.rate;
  voice.ramp = c.ramp;
  voice.weight = c.weight;
  voice.out = c.out;
  voice.start = c.start;
  voice.outAt = c.outAt;
  if (voice.reopen(t) && voice.owner?.holding) voice.owner.holding.played--;
  voice.doneAt = Number.POSITIVE_INFINITY;
  if (voice.parts !== null) {
    for (const [subject, r] of voice.parts) if (r.at > t) voice.parts.delete(subject);
    if (voice.parts.size === 0) voice.parts = null;
  }
  if (voice.parted !== null) {
    for (const [subject, at] of voice.parted) if (at > t) voice.parted.delete(subject);
    if (voice.parted.size === 0) voice.parted = null;
  }
  voice.seen = 0;
  voice.restedCount = 0;
  voice.early = null;
  voice.holder = null;
  voice.keepOn = null;
  voice.laned = false;
  voice.unreached = null;
  voice.unreachedBits = null;
  voice.seeks++;
  voice.subjects = new Restored(voice.subjects, (live) => {
    const h = restore(voice, live, t);
    if (h === undefined) return h;
    if (h.reaches) voice.seen++;
    if (h.rested) voice.restedCount++;
    if (voice.state === 'pending') {
      voice.early ??= [];
      voice.early.push(h);
    }
    return h;
  });
}

/** Each voice's state at mix time `t`, once every clock above it is back where it was. */
function stateAt<I, O>(voice: Voice<I, O>, t: number): Voice<I, O>['state'] {
  if ((voice.owner === null ? t : ownerReading(voice.owner, t)) < voice.start) return 'pending';
  if (voice.out !== null && voice.out.at <= t) return 'fading';
  if (voice.freezesAfter && voice.elapsedAt(t) >= voice.span + voice.latest) return 'frozen';
  return 'live';
}

/** Moves the mix to mix time `t`, as it stood at the end of that frame. */
export function seek<I, O>(mix: Mixer<I, O>, t: number): void {
  if (mix.projecting) throw new Error('blits: a projection does not seek');
  const history = mix.opts.history;
  if (!history) throw new Error('blits: seeking needs a mix made with history');
  const tape = mix.tape;
  if (tape === undefined)
    throw new Error('blits: seeking needs history.tape, which keeps the calls a seek plays again');
  if (Number.isNaN(mix.now))
    throw new Error('blits: a mix that has never synced has nothing to seek');
  if (t === Number.POSITIVE_INFINITY) throw new RangeError('blits: a mix seeks to a finite time');
  if (!(t >= mix.now - history.ms && t >= mix.born))
    throw new Error(`blits: ${t} is older than this mix's history reaches`);
  if (t >= mix.now) replay(mix, () => t);
  // Under the rate the recorded calls up to `t` set, ahead; behind, under the rate it had then.
  const u = hostAt(mix, t);
  if (!Number.isFinite(u)) throw new RangeError(`blits: the mix's rate never reaches ${t}`);
  if (t >= mix.now) {
    mix.u = u;
    move(mix, t);
  } else back(mix, tape, t, u);
  // The host's clock reads on from here: its next sync reads `t` plus its time since its last.
  mix.offset = mix.last - u;
  mix.u = u;
  mix.stir();
  const bookers = mix.bookers;
  if (bookers !== null) for (const b of bookers) b.rewound();
}

/** Puts the mix back as it stood at the end of frame `t`, at host time `u`. */
function back<I, O>(mix: Mixer<I, O>, tape: Tape, t: number, u: number): void {
  const n = tape.depthAt(t);
  if (n < tape.undoDepth()) tape.goto(n);
  const all = [...mix.cued, ...mix.gone].sort((a, b) => a.id - b.id);
  const kept: Voice<I, O>[] = [];
  const gone: Voice<I, O>[] = [];
  // Every motion patch takes back the changes made after `t`, which the tape makes again.
  const motions = new Set<Motions<I>>();
  for (const voice of all) if (voice.motion !== undefined) motions.add(voice.motion);
  for (const voice of all)
    if (voice.cuedAt > t) park(mix, voice);
    else if (voice.doneAt <= t) gone.push(voice);
    else kept.push(voice);
  for (const voice of kept) restoreVoice(voice, t);
  for (const voice of kept) voice.state = stateAt(voice, t);
  mix.cued = kept;
  mix.gone = gone;
  mix.retired = [];

  // Owners hold what is back; a voice that went live again counts its place in its owner anew.
  for (const voice of kept)
    if (voice.holding !== null) voice.holding.children = kept.filter((v) => v.owner === voice);

  // Rebuilt from the voices that are back: the lanes, the chains and every count the fold reads.
  const oldLanes = mix.lanes;
  if (oldLanes !== null) mix.lanes = new Lanes<I, O>(laneHost(mix));
  mix.chains = new Store();
  mix.named = new Store();
  mix.naming = 0;
  mix.general = [];
  for (const voice of kept) index(mix, voice);
  mix.owners = kept.some((v) => v.holding !== null) ? kept.filter((v) => v.holding !== null) : null;
  mix.loci = kept.filter((v) => v.spec.locus !== undefined).length;
  mix.anchored = kept.filter((v) => v.spec.anchor !== undefined).length;
  mix.parters.clear();
  for (const voice of [...kept, ...gone])
    if (voice.parts !== null || voice.parted !== null) mix.parters.add(voice);
  mix.steps.push(null, ++mix.version);
  mix.relinks++;
  mix.pose = new Store();
  if (mix.restStamps !== null) mix.restStamps = new Store();
  mix.pulled = [];
  mix.pulledHeads = [];
  mix.pulledSlots = new Int32Array(0);
  mix.pulledVersion = Number.NaN;
  mix.pulledRelinks = -1;
  for (const voice of [...kept, ...gone]) {
    voice.unreached = null;
    voice.unreachedBits = null;
    const blend = voice.blend?.of;
    if (blend !== undefined) {
      blend.frame = 0;
      blend.reads = new Store();
      blend.frames = new Float64Array(0);
      blend.values = new Float64Array(0);
    }
  }

  // A motion patch is asked for its time by the latest voice playing it.
  mix.playing.clear();
  for (const voice of kept) {
    const motion = voice.motion;
    if (motion === undefined) continue;
    mix.playing.set(motion, (mix.playing.get(motion) ?? 0) + 1);
    if (mix.owner !== null) {
      motion.owner = mix.owner;
      motion.ownerId = voice.id;
    }
  }
  for (const motion of motions) {
    if (oldLanes !== null && motion.watcher === oldLanes) motion.watcher = null;
    motion.rewind(t);
  }

  // What history kept after `t` is let go; the tape holds the calls that made it.
  mix.hostLog = mix.hostLog.filter((e) => e.at <= t);
  mix.announced = mix.announced.filter((a) => a.made <= t);
  mix.sent = mix.sent.filter((e) => e.timestamp <= t);
  mix.sentTo = t;
  mix.pace?.cut(u);
  mix.u = u;
  mix.now = t;
  mix.pins = null;
  for (const voice of kept)
    if (voice.state === 'pending' && !Number.isNaN(voice.pinned)) {
      mix.pins ??= new Map();
      mix.pins.set(voice, voice.pinned);
    }
  mix.due = [];
  for (const voice of kept) schedule(mix, voice);
  mix.stir();
  move(mix, t);
}
