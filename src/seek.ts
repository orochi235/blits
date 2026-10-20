import { heldAt } from './chain.js';
import { schedule } from './due.js';
import { fadesAt } from './fade.js';
import { origin } from './held.js';
import { apart, copyHeld, copyHeldInto, lastIndex, lastWithin, unread } from './history.js';
import { laneHost } from './hosts.js';
import { Leavings } from './leavings.js';
import type { Mixer } from './mixer.js';
import type { Motions } from './motions.js';
import { move, nextFrame } from './move.js';
import { ownerReading } from './owner.js';
import { place } from './place.js';
import { unpull } from './pull.js';
import { Restored } from './restored.js';
import { recount } from './roster.js';
import { refitAll } from './spans.js';
import { Store } from './store.js';
import { hostAhead, hostAt, replay } from './tape.js';
import type { Frame, Transport } from './transport.js';
import { cover, coverFrame, cut } from './unpage.js';
import type { Controls, Snap, Subject, Voice } from './voice.js';

/**
 * A voice's record of one subject as it stood at mix time `t`, from the latest copy kept by then;
 * undefined for a stateful record first made after `t`, which is met afresh. A stateless record
 * holds nothing that moves with time, so it is copied whenever it was made. The weight its last
 * probe by `t` read is not kept, and a lane holds it apart from the record, so the record reads 0
 * until the next probe.
 */
function restore<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  live: Subject<unknown>,
  t: number,
  every: number,
  mine: boolean,
): Subject<unknown> | undefined {
  const inputs = live.inputs?.filter((e) => e.at <= t);
  const snaps = live.snaps;
  if (snaps === undefined) {
    // Nothing a step or `setting.keep` holds: what it keeps does not move with time. One record
    // stands for every subject a voice does not reach, so that one is copied.
    const h = mine && live.reaches ? unread(live) : copyHeld(voice, live);
    if (h.stepped > t) h.stepped = t;
    // Whether it had rested by `t` is not kept; the next probe finds it again.
    h.rested = false;
    h.weight = 0;
    h.inputs = inputs;
    if (!(h.since <= t)) origin(mix, voice, h);
    return h;
  }
  const at = lastIndex(snaps, t, true);
  if (at < 0) return undefined;
  const snap = snaps[at] as NonNullable<typeof snaps>[number];
  // What the record replaced held, which a record put back over it would lose.
  const { ticks, since, rebuilt, state, slot, restored } = live;
  let h: Subject<unknown>;
  if (mine && live.reaches) {
    // Its chain may still read its number from it, and its store has just stamped it.
    h = copyHeldInto(voice, snap.held, live, true);
    h.slot = slot;
    h.restored = restored;
  } else h = copyHeld(voice, snap.held, true);
  h.weight = 0;
  if (snap.at < t) h.copied = true;
  const kept = at + 1;
  // The record replaced is let go, so its list is cut where it stands.
  if (mine) trim(voice, snaps, kept);
  else for (let i = 0; i < kept; i++) (snaps[i] as Snap<unknown>).shared = true;
  h.snaps = mine ? snaps : snaps.slice(0, kept);
  h.inputs = inputs;
  // A start still ahead when the copy was kept may have moved before `t`, with no copy between.
  if (!(h.since <= snap.at)) origin(mix, voice, h);
  // The record a seek replaces, stepped on from this copy with nothing since rebuilding or moving
  // its start, holds the copy's state at its own `ticks`, which a probe there need not step to.
  const was = mine && ticks > h.ticks && since === h.since && rebuilt === h.rebuilt;
  if (voice.patch.step !== undefined && (snap.ahead !== undefined || t - snap.at >= every || was)) {
    let ahead = snap.ahead;
    // Steps counted from a start that has moved since are not this record's.
    if (ahead === undefined || ahead.since !== h.since) {
      ahead = {
        put: h,
        sought: t,
        since: h.since,
        at: snap.at,
        ticks: h.ticks,
        state: undefined,
        leftTicks: 0,
        left: undefined,
      };
      snap.ahead = ahead;
    } else {
      ahead.put = h;
      ahead.sought = t;
    }
    if (was) {
      // Nothing else holds the record replaced, so its state is taken, not copied.
      ahead.leftTicks = ticks;
      ahead.left = state;
    }
  }
  return h;
}

/** Cuts a record's list of copies to its first `kept`, keeping those no other list holds as spares. */
function trim<I, O>(voice: Voice<I, O>, snaps: Snap<unknown>[], kept: number): void {
  while (snaps.length > kept) {
    const snap = snaps.pop() as Snap<unknown>;
    if (snap.shared) continue;
    snap.ahead = undefined;
    voice.spares ??= [];
    voice.spares.push(snap);
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
    for (const [subject, p] of voice.parted) {
      if (p.seq <= seq) continue;
      voice.parted.delete(subject);
      if (p.ramp === undefined || p.ramp.seq > seq) continue;
      voice.parts ??= new Map();
      voice.parts.set(subject, p.ramp);
    }
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
  voice.spares = null;
  const left = voice.left?.all() ?? [];
  if (voice.left !== null) fadesAt(voice, voice.left.after(cut), seq);
  voice.left = Leavings.from(left.filter((e) => e.seq <= seq));
  const future = Leavings.from(left.filter((e) => e.seq > seq));
  let records = voice.subjects;
  if (!(records instanceof Restored)) {
    const every = apart(mix.opts.history as { every?: number });
    const now = (subject: I, held: Subject<unknown> | undefined, least: number, seq: number) =>
      heldAt(voice, subject, held, least, seq);
    records = new Restored(records, now, (live, least, top, mine) => {
      const h = restore(mix, voice, live, least, every, mine);
      if (h === undefined) return h;
      if (h.reaches) voice.seen++;
      if (h.rested) voice.restedCount++;
      if (!(h.since <= top)) {
        voice.early ??= [];
        voice.early.push(h);
      }
      return h;
    });
    voice.subjects = records;
  }
  (records as Restored<I>).back(t, cut, future);
}

/** Each voice's state at mix time `t`, once every clock above it is back where it was. */
function stateAt<I, O>(voice: Voice<I, O>, t: number): Voice<I, O>['state'] {
  // A fade begins at once, even one whose ramp starts later, at the voice's start.
  if (voice.out !== null) return 'fading';
  if ((voice.owner === null ? t : ownerReading(voice.owner, t)) < voice.start) return 'pending';
  if (voice.freezesAfter && voice.elapsedAt(t) >= voice.span + voice.latest) return 'frozen';
  return 'live';
}

/**
 * Moves every mix on the transport to mix time `to`, as it stood at the end of that frame, or to
 * the end of the frame numbered `to.frame`.
 */
export function seek(transport: Transport, to: number | { readonly frame: number }): void {
  if (transport.projecting) throw new Error('blits: a projection does not seek');
  const history = transport.history;
  if (!history) throw new Error('blits: seeking needs a mix made with history');
  const tape = transport.tape;
  if (tape === undefined)
    throw new Error('blits: seeking needs history.tape, which keeps the calls a seek plays again');
  if (Number.isNaN(transport.now))
    throw new Error('blits: a mix that has never synced has nothing to seek');
  let t: number;
  let frame: Frame | undefined;
  if (typeof to === 'number') {
    t = to;
    if (t === Number.POSITIVE_INFINITY) throw new RangeError('blits: a mix seeks to a finite time');
    if (!(t >= transport.born))
      throw new Error(`blits: ${t} is older than this mix's history reaches`);
    cover(transport, t);
    if (t < transport.now) {
      frame = transport.frames.at(t);
      if (frame === undefined)
        throw new Error(`blits: ${t} is older than this mix's history reaches`);
    }
  } else {
    const f = coverFrame(transport, to.frame);
    t = f.at;
    // The frame being played is where the mix stands; any other is behind it, whatever its time.
    if (f.seq !== transport.seq) frame = f;
  }
  if (frame === undefined) {
    // Ahead, under the rate the recorded calls up to `t` set, past any frames rate 0 held at `t`.
    const last = replay(
      transport,
      (at) => (transport.pace === null ? at : transport.pace.reading(at)) <= t,
    );
    const at = hostAhead(transport, t);
    const u = Number.isNaN(last) ? at : Math.max(last, at);
    if (!Number.isFinite(u)) throw new RangeError(`blits: the mix's rate never reaches ${t}`);
    transport.u = u;
    // A call played at `t` itself moved the mixes there before it, as a sync does.
    if (Number.isNaN(last) || transport.now !== t) for (const m of transport.members) move(m, t);
  } else {
    // On the frame itself, its own host time: rate 0 may have held the clock there for several.
    const u = frame.at === t ? frame.u : hostAt(transport, t);
    const seq = frame.seq;
    tape.goto(tape.depthAt(u));
    transport.undrop(seq);
    // What history kept after the frame is let go; the tape holds the calls that made it.
    transport.announced = transport.announced.filter((a) => a.seq <= seq);
    transport.frames.set(transport.frames.all().filter((f) => f.seq <= seq));
    if (transport.pacedSeq > seq) {
      transport.pace = null;
      transport.pacedSeq = Number.POSITIVE_INFINITY;
    } else transport.pace?.cut(u);
    transport.u = u;
    transport.now = t;
    for (const m of transport.members) back(m, t, seq, frame.at < t);
    cut(transport, seq);
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
    if (voice.holding !== null) {
      voice.holding.children = kept.filter((v) => v.owner === voice);
      voice.holding.back(seq);
    }

  // Rebuilt from the voices that are back: the lanes, the chains and every count the fold reads.
  // Subject numbers carry over, and with them the chains that hold them, each linked afresh.
  const oldLanes = mix.lanes;
  if (oldLanes !== null && mix.lanesOf !== null)
    mix.lanes = new mix.lanesOf<I, O>(laneHost(mix), oldLanes);
  else mix.chains = new Store();
  mix.owners = kept.some((v) => v.holding !== null) ? kept.filter((v) => v.holding !== null) : null;
  recount(mix);
  mix.parters.clear();
  for (const voice of [...kept, ...gone])
    if (voice.parts !== null || voice.parted !== null) mix.parters.add(voice);
  mix.relinks++;
  mix.pose = new Store();
  if (mix.restStamps !== null) mix.restStamps = new Store();
  unpull(mix);
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
