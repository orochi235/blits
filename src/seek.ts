import { index } from './chain.js';
import { schedule } from './due.js';
import { copyHeld, last, lastWithin } from './history.js';
import { laneHost } from './hosts.js';
import { Lanes } from './lanes.js';
import { Leavings } from './leavings.js';
import type { Mixer } from './mixer.js';
import type { Motions } from './motions.js';
import { move, nextFrame } from './move.js';
import { ownerReading } from './owner.js';
import { place } from './place.js';
import { refitAll } from './spans.js';
import { Store } from './store.js';
import { hostAt, replay } from './tape.js';
import type { Transport } from './transport.js';
import { cover, cut } from './unpage.js';
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
 * A voice's records after a seek back: each subject's is put back from the records it had, the first
 * time it is asked for, since the subjects a store holds cannot be listed.
 */
class Restored<I> extends Store<I, Subject<unknown>> {
  constructor(
    private readonly was: Store<I, Subject<unknown>>,
    private readonly make: (live: Subject<unknown>) => Subject<unknown> | undefined,
    private readonly left: (key: I) => Subject<unknown> | undefined,
  ) {
    super();
  }

  /** Subjects whose record has been put back or deleted, which `left` no longer answers for. */
  private readonly settled = new Store<I, true>();

  override get(key: I): Subject<unknown> | undefined {
    const v = super.get(key);
    if (v !== undefined) return v;
    // A subject that left after the moment sought had the record it left with, whatever it has now.
    const kept = this.settled.get(key) === undefined ? this.left(key) : undefined;
    this.settled.set(key, true);
    const live = kept ?? this.was.get(key);
    if (live === undefined) return undefined;
    this.was.delete(key);
    const made = this.make(live);
    if (made !== undefined) super.set(key, made);
    return made;
  }

  override delete(key: I): void {
    super.delete(key);
    this.was.delete(key);
    this.settled.set(key, true);
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

/** Puts a voice's controls and records back as they stood at mix time `t`, the end of frame `seq`. */
function restoreVoice<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, t: number, seq: number): void {
  const cut = { seq, strict: false };
  const log = voice.log as Controls[];
  const c = lastWithin(log, cut) ?? (log[0] as Controls);
  log.length = log.indexOf(c) + 1;
  voice.take(c);
  if (voice.reopen(seq) && voice.owner?.holding) voice.owner.holding.played--;
  voice.doneAt = Number.POSITIVE_INFINITY;
  voice.doneSeq = Number.POSITIVE_INFINITY;
  if (voice.parts !== null) {
    for (const [subject, r] of voice.parts) if (r.seq > seq) voice.parts.delete(subject);
    if (voice.parts.size === 0) voice.parts = null;
  }
  if (voice.parted !== null) {
    for (const [subject, p] of voice.parted) if (p.seq > seq) voice.parted.delete(subject);
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
  const left = voice.left?.all() ?? [];
  voice.left = Leavings.from(left.filter((e) => e.seq <= seq));
  const future = Leavings.from(left.filter((e) => e.seq > seq));
  voice.subjects = new Restored(
    voice.subjects,
    (live) => {
      const h = restore(voice, live, t);
      if (h === undefined) return h;
      if (h.reaches) voice.seen++;
      if (h.rested) voice.restedCount++;
      if (!(h.since <= t)) {
        // Kept while its origin was still ahead: where the controls put back place it now.
        h.since = mix.sinceOf(voice, h.delay);
        h.shown = mix.shownOf(voice, h.since);
        if (h.ticks === 0 && h.stepped > h.since) h.stepped = h.since;
      }
      if (!(h.since <= t)) {
        voice.early ??= [];
        voice.early.push(h);
      }
      return h;
    },
    (key) => future?.at(key, cut),
  );
}

/** Each voice's state at mix time `t`, once every clock above it is back where it was. */
function stateAt<I, O>(voice: Voice<I, O>, t: number): Voice<I, O>['state'] {
  // A fade begins at once, even one whose ramp starts later, at the voice's start.
  if (voice.out !== null) return 'fading';
  if ((voice.owner === null ? t : ownerReading(voice.owner, t)) < voice.start) return 'pending';
  if (voice.freezesAfter && voice.elapsedAt(t) >= voice.span + voice.latest) return 'frozen';
  return 'live';
}

/** Moves every mix on the transport to mix time `t`, as it stood at the end of that frame. */
export function seek(transport: Transport, t: number): void {
  if (transport.projecting) throw new Error('blits: a projection does not seek');
  const history = transport.history;
  if (!history) throw new Error('blits: seeking needs a mix made with history');
  const tape = transport.tape;
  if (tape === undefined)
    throw new Error('blits: seeking needs history.tape, which keeps the calls a seek plays again');
  if (Number.isNaN(transport.now))
    throw new Error('blits: a mix that has never synced has nothing to seek');
  if (t === Number.POSITIVE_INFINITY) throw new RangeError('blits: a mix seeks to a finite time');
  if (!(t >= transport.born))
    throw new Error(`blits: ${t} is older than this mix's history reaches`);
  const unpaged = cover(transport, t);
  if (t >= transport.now) {
    // Ahead, under the rate the recorded calls up to `t` set, past any frames rate 0 held at `t`.
    const last = replay(
      transport,
      (at) => (transport.pace === null ? at : transport.pace.reading(at)) <= t,
    );
    const u = Number.isNaN(last) ? hostAt(transport, t) : Math.max(last, hostAt(transport, t));
    if (!Number.isFinite(u)) throw new RangeError(`blits: the mix's rate never reaches ${t}`);
    transport.u = u;
    for (const m of transport.members) move(m, t);
  } else {
    const frame = transport.frameAt(t);
    if (frame === undefined)
      throw new Error(`blits: ${t} is older than this mix's history reaches`);
    // On the frame itself, its own host time: rate 0 may have held the clock there for several.
    const u = frame.at === t ? frame.u : hostAt(transport, t);
    const seq = frame.seq;
    tape.goto(tape.depthAt(u));
    transport.undrop(seq);
    // What history kept after the frame is let go; the tape holds the calls that made it.
    transport.announced = transport.announced.filter((a) => a.seq <= seq);
    transport.frames = transport.frames.filter((f) => f.seq <= seq);
    if (transport.pacedSeq > seq) {
      transport.pace = null;
      transport.pacedSeq = Number.POSITIVE_INFINITY;
    } else transport.pace?.cut(u);
    transport.u = u;
    transport.now = t;
    for (const m of transport.members) back(m, t, seq, frame.at < t);
    cut(transport, seq, unpaged);
  }
  transport.tick(t);
  // The host's clock reads on from here: its next sync reads `t` plus its time since its last.
  transport.offset = transport.last - transport.u;
  transport.kept();
  for (const m of transport.members) {
    m.stir();
    const bookers = m.bookers;
    if (bookers !== null) for (const b of bookers) b.sought();
  }
}

/**
 * Puts one mix back as it stood at mix time `t`, the end of frame `seq`, its transport already
 * there; `on` past that frame's own time, where it moves on to `t`.
 */
function back<I, O>(mix: Mixer<I, O>, t: number, seq: number, on: boolean): void {
  const all = [...mix.cued, ...mix.gone].sort((a, b) => a.id - b.id);
  const kept: Voice<I, O>[] = [];
  const gone: Voice<I, O>[] = [];
  // Every motion patch takes back the changes made after `t`, which the tape makes again.
  const motions = new Set<Motions<I>>();
  for (const voice of all) if (voice.motion !== undefined) motions.add(voice.motion);
  for (const voice of all)
    if (voice.cuedSeq > seq) park(mix, voice);
    else if (voice.doneSeq <= seq) gone.push(voice);
    else kept.push(voice);
  for (const voice of kept) restoreVoice(mix, voice, t, seq);
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
    motion.rewind(seq);
  }

  // What history kept after `t` is let go; the tape holds the calls that made it.
  mix.hostLog = mix.hostLog.filter((e) => e.seq <= seq);
  mix.sent = mix.sent.filter((e) => e.timestamp <= t);
  mix.sentTo = t;
  mix.pins = null;
  for (const voice of kept)
    if (voice.state === 'pending' && !Number.isNaN(voice.pinned)) {
      mix.pins ??= new Map();
      mix.pins.set(voice, voice.pinned);
    }
  refitAll(mix);
  mix.due = [];
  for (const voice of kept) schedule(mix, voice);
  mix.stir();
  // On the frame's own time its move is behind it: a second would land what the next frame does.
  if (on) move(mix, t);
  else {
    mix.frame = nextFrame();
    mix.reducedNow = mix.reduced;
    // A voice history let go of may have placed an anchor then: placed again from what it holds.
    const ms = (mix.opts.history as { ms: number }).ms;
    if (mix.anchored > 0 && mix.transport.forgotTo >= t - ms) place(mix);
  }
}
