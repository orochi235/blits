import { ownBlends } from './blend.js';
import { heldAt } from './chain.js';
import { stepOf } from './clock.js';
import { open, sighted, weightAt } from './everyone.js';
import { meet, origin } from './held.js';
import { copyHeld, last, lastWithin } from './history.js';
import { markOf, voiceMarks } from './marks.js';
import { Mixer } from './mixer.js';
import { move } from './move.js';
import { heldByInput, ownerReading, relink } from './owner.js';
import { pin, place } from './place.js';
import { reading } from './reading.js';
import { record } from './record.js';
import { recount } from './roster.js';
import { copyStanding, stands } from './standing.js';
import { hostAt, replay } from './tape.js';
import { type Cut, type Frame, Transport, within } from './transport.js';
import type { Doubt, Mix, Projection, Tape, TransportProjection } from './types.js';
import { cover, coverFrame } from './unpage.js';
import { unreached } from './unreached.js';
import type { Controls, Subject, Voice } from './voice.js';

/**
 * Every mix on a transport read at mix time `t`, through copies of them on a transport of their
 * own, moved together so an anchor across mixes answers as it would live. Ahead, they stop at each
 * known event on the way, and a subject asked about is read at each before `t`.
 */
export function projectAll(
  transport: Transport,
  at: number | { readonly frame: number },
): TransportProjection {
  const kept = transport.history !== undefined;
  let t: number;
  let numbered: Frame | undefined;
  if (typeof at === 'number') t = at;
  else {
    if (!kept) throw new Error('blits: reading a frame back needs a mix made with history');
    numbered = coverFrame(transport, at.frame);
    t = numbered.at;
  }
  // The frame being played reads as the mix's own time does; any other is behind, whatever its time.
  const ahead =
    numbered !== undefined
      ? numbered.seq === transport.seq
      : Number.isNaN(transport.now) || t >= transport.now;
  const pace = transport.pace;
  // Behind, the last frame at or before `t`, read as it showed when `t` is that frame's own time.
  let cut: Cut = { seq: transport.seq, strict: false };
  let u = hostAt(transport, t);
  if (!ahead && kept) {
    if (numbered === undefined) cover(transport, t);
    const frame = numbered ?? transport.frames.at(t);
    if (frame !== undefined) {
      cut = { seq: frame.seq, strict: frame.at === t };
      if (frame.at === t) u = frame.u;
    }
  } else if (!ahead) stands(transport, t);
  const c = new Transport(undefined, true);
  c.offset = transport.offset;
  c.u = u;
  c.nextId = transport.nextId;
  c.now = ahead ? transport.now : t;
  c.pace =
    pace === null || !within(cut, transport.pacedSeq)
      ? null
      : pace.until(ahead ? Number.POSITIVE_INFINITY : u);
  c.announced = (
    ahead ? transport.announced : transport.announced.filter((a) => within(cut, a.seq))
  ).map((a) => ({ ...a }));
  const copies = new Map<Mixer<unknown, unknown>, Mixer<unknown, unknown>>();
  for (const mix of transport.members) {
    const copy = new Mixer<unknown, unknown>(
      mix.kit,
      {
        ...mix.opts,
        history: undefined,
        lanes: false,
        transport: c,
      },
      null,
    );
    copy.slot = mix.slot;
    copy.projecting = true;
    copies.set(mix, copy);
    if (ahead) copyAhead(mix, copy);
    else if (kept) copyBack(mix, copy, t, cut);
    else copyStanding(mix, copy, t, cut);
  }
  // A read at the mix's own time lands nothing, as a probe does not: what the host has done since
  // the last sync shows at the next one.
  let stood = c;
  let earlier: Map<Mixer<unknown, unknown>, Stages> | null = null;
  if (ahead && t !== transport.now) {
    earlier = new Map();
    stood = playAhead(transport, c, copies, t, earlier);
  }
  const read = <T>(f: () => T): T => {
    reading.live = false;
    reading.ahead = stood.ahead.size > 0 ? stood.ahead : null;
    try {
      return f();
    } finally {
      reading.live = true;
      reading.ahead = null;
    }
  };
  return {
    timestamp: t,
    of<I, O, H>(mix: Mix<I, O, H>): Projection<I, O> {
      const key = mix as unknown as Mixer<unknown, unknown>;
      const copy = copies.get(key) as Mixer<I, O> | undefined;
      if (copy === undefined) throw new Error('blits: that mix is not on this transport');
      const stages = earlier?.get(key);
      // A subject asked about is read at every stop first, in order, so the state it carries
      // crosses each event as a frame there would carry it.
      const warm =
        stages === undefined
          ? null
          : (subject: I) => {
              if (stages.met.has(subject)) return;
              stages.met.add(subject);
              for (const stage of stages.at) stage.fold(subject);
            };
      return {
        timestamp: t,
        probe: (subject, out) =>
          read(() => {
            warm?.(subject);
            return copy.fold(subject, out);
          }),
        assess: (subject) =>
          read(() => {
            warm?.(subject);
            copy.fold(subject);
            return doubts(copy, subject);
          }),
      };
    },
  };
}

/** A live mix's copies at each known event a read ahead stopped at, and the subjects read there. */
interface Stages {
  at: Mixer<unknown, unknown>[];
  met: Set<unknown>;
}

/**
 * Moves a read ahead's copies to mix time `t`, making the calls the tape holds on the way as a seek
 * there makes them on the mixes. While a voice could carry state across it, it stops at each known
 * event: a call, and every mark of a voice or announced. At each stop the copies are kept for
 * subjects to be read there and copied on, so `copies` ends holding those at `t`. Answers the
 * transport they stand on, and puts the tape back where it stood.
 */
function playAhead(
  transport: Transport,
  c: Transport,
  copies: Map<Mixer<unknown, unknown>, Mixer<unknown, unknown>>,
  t: number,
  earlier: Map<Mixer<unknown, unknown>, Stages>,
): Transport {
  const tape = transport.tape;
  const depth = tape?.undoDepth() ?? 0;
  let played = false;
  try {
    for (;;) {
      const e = nextEvent(tape, c, t);
      if (!(e < t)) break;
      played = playTo(transport, c, copies, e) || played;
      if (!carries(c)) continue;
      // Placed now, as the next move would place them, while a target that has just left is here.
      for (const m of c.members) if (m.anchored > 0) place(m);
      const next = restage(c);
      for (const [mix, copy] of copies) {
        const on = new Mixer<unknown, unknown>(copy.kit, { ...copy.opts, transport: next }, null);
        on.slot = copy.slot;
        on.projecting = true;
        copyAhead(copy, on);
        const stages = earlier.get(mix);
        if (stages === undefined) earlier.set(mix, { at: [copy], met: new Set() });
        else stages.at.push(copy);
        copies.set(mix, on);
      }
      c = next;
    }
    played = playTo(transport, c, copies, t) || played;
  } finally {
    if (played) tape?.goto(depth);
  }
  return c;
}

/**
 * Whether a voice on a read ahead's copies could carry state from one known event to the next: a
 * patch that steps, or a weight given by a signal, which may keep state. Where none could, a read
 * crosses the events in one go, as fast as one with none.
 */
function carries(c: Transport): boolean {
  for (const m of c.members)
    for (const v of m.cued)
      if (v.state !== 'done' && (v.patch.step !== undefined || typeof v.spec.weight === 'function'))
        return true;
  return false;
}

/**
 * The earliest known event a read ahead's copies have yet to reach before `t`, mix time: the next
 * call the tape holds, and while a voice could carry state across one, a mark of a voice or one
 * announced. Infinity where there is none.
 */
function nextEvent(tape: Tape | undefined, c: Transport, t: number): number {
  const now = c.now;
  let e = Number.POSITIVE_INFINITY;
  const call = tape?.timestampAt(tape.undoDepth());
  if (call !== undefined) e = c.pace === null ? call : c.pace.reading(call);
  if (!carries(c)) return e < t ? e : Number.POSITIVE_INFINITY;
  for (const m of c.members)
    for (const v of m.cued) {
      if (v.state === 'done') continue;
      for (const mark of voiceMarks) {
        const at = markOf(m, v, mark);
        if (at !== undefined && at > now && at < e) e = at;
      }
      const inner = v.spec.marks;
      if (inner !== undefined)
        for (const mark of Object.keys(inner)) {
          const at = markOf(m, v, mark);
          if (at !== undefined && at > now && at < e) e = at;
        }
    }
  for (const a of c.announced) {
    const at = c.pace === null ? a.at : c.pace.at(a.at, c.u);
    if (at > now && at < e) e = at;
  }
  return e < t ? e : Number.POSITIVE_INFINITY;
}

/**
 * Makes the calls the tape holds up to mix time `to` on a read ahead's copies and moves them
 * there. Answers whether it moved the tape.
 */
function playTo(
  transport: Transport,
  c: Transport,
  copies: Map<Mixer<unknown, unknown>, Mixer<unknown, unknown>>,
  to: number,
): boolean {
  const tape = transport.tape;
  const due = (at: number) => (c.pace === null ? at : c.pace.reading(at)) <= to;
  const next = tape?.timestampAt(tape.undoDepth());
  c.u = hostAt(c, to);
  let played = false;
  if (next !== undefined && due(next)) {
    // A call may write what a copy shares with the voice it was copied from.
    for (const copy of c.members)
      for (const v of copy.cued) {
        if (v.parts !== null) v.parts = new Map(v.parts);
        if (v.parted !== null) v.parted = new Map(v.parted);
      }
    played = true;
    const last = replay(transport, due, c, {
      transport: () => c,
      mix: (of) => copies.get(of as unknown as Mixer<unknown, unknown>) as typeof of | undefined,
    });
    c.u = Math.max(last, hostAt(c, to));
  }
  // A call played at `to` itself moved the copies there before it, as a sync does.
  if (!(c.now >= to)) for (const copy of c.members) move(copy, to);
  return played;
}

/** A transport for a read ahead's copies to go on from where those on `c` stand. */
function restage(c: Transport): Transport {
  const next = new Transport(undefined, true);
  next.offset = c.offset;
  next.u = c.u;
  next.nextId = c.nextId;
  next.now = c.now;
  next.pace = c.pace === null ? null : c.pace.until(Number.POSITIVE_INFINITY);
  next.announced = c.announced.map((a) => ({ ...a }));
  // The retargets and pushes the tape made carry their times, so every stop shares one list.
  next.ahead = c.ahead;
  return next;
}

/**
 * A mix's copy for a read ahead: its voices as they stand, each subject carried from the live one,
 * or from the copy at the known event before.
 */
function copyAhead<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>): void {
  mirror(mix, c);
  c.cued = mix.cued
    .filter((v) => v.state !== 'done')
    .map((v) => {
      const copy: Voice<I, O> = v.copy(
        (subject) => carry(mix, v, subject, c, copy),
        undefined,
        true,
      );
      const at = mix.pins?.get(v);
      if (at !== undefined) pin(c, copy, at);
      return copy;
    });
  ownBlends(c.cued);
  // A copy keeps no list of owners, so the one before says only by its voices.
  if (mix.owners !== null || (mix.projecting && c.cued.some((v) => v.holding !== null)))
    relink(c.cued);
  recount(c);
}

/** A mix's copy for a read back to `t`, cut at `cut`: its voices then, from the controls and copies kept. */
function copyBack<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>, t: number, cut: Cut): void {
  mirror(mix, c);
  c.backward = true;
  // Copied as the frame's first probe began, so its own frame shows it.
  const was = lastWithin(mix.hostLog, { seq: cut.seq, strict: false });
  const host = mix.opts.host;
  const then =
    was && typeof host === 'object' && host !== null
      ? Object.assign(Object.create(host) as object, was.fields)
      : undefined;
  if (was) c.hostThen = was;
  c.cued = [...mix.cued, ...mix.gone]
    .filter((v) => v.cuedSeq <= cut.seq && !within(cut, v.doneSeq, true))
    .sort((a, b) => a.id - b.id)
    .map((v) => {
      const log = v.log as Controls[];
      const copy: Voice<I, O> = v.copy(
        (subject) => recall(mix, v, subject, t, cut, c, copy),
        lastWithin(log, cut) ?? (log[0] as Controls),
      );
      if (then !== undefined) copy.setting.host = then;
      if (copy.parted !== null)
        for (const [subject, p] of copy.parted) {
          // A ramp that has ended since was still running at `t`.
          if (p.ramp === undefined || !(t < p.at)) continue;
          const parts = copy.parts === v.parts ? new Map(v.parts) : copy.parts;
          parts?.set(subject, p.ramp);
          copy.parts = parts;
        }
      return copy;
    });
  ownBlends(c.cued);
  if (mix.owners !== null) relink(c.cued, cut.seq);
  stateAt(c, t);
  recount(c);
}

/** Sets each copied voice's state to what its clock and fade make it at `t`. */
export function stateAt<I, O>(c: Mixer<I, O>, t: number): void {
  for (const copy of c.cued)
    copy.state = copy.out
      ? 'fading'
      : (copy.owner === null ? t : ownerReading(copy.owner, t)) < copy.start
        ? 'pending'
        : copy.freezesAfter && copy.elapsedAt(t) >= copy.span + copy.latest
          ? 'frozen'
          : 'live';
}

/** Gives a projection's copy what it reads of the live mix as it is, before its voices are copied. */
export function mirror<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>): void {
  c.pose = mix.pose;
  c.wantsPose = mix.wantsPose;
  c.reducedNow = mix.reducedNow;
}

/** A voice's record of a subject, the one it shares among those it does not reach included. */
function recordOf<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
): Subject<unknown> | undefined {
  // A voice sharing one record has that for every subject a chain has asked it about, pointed at
  // the subject for the caller to copy from.
  if (voice.sharing) {
    const slot = mix.chains.get(subject)?.slot ?? -1;
    if (!sighted(voice, slot)) return undefined;
    const all = voice.everyone as Subject<unknown>;
    open(voice, all, slot);
    all.weight = weightAt(voice, slot);
    return all;
  }
  const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
  if (held !== undefined || voice.unreachedBits === null) return held;
  return unreached(voice, mix.chains.get(subject)?.slot ?? -1)
    ? (voice.unreached as Subject<unknown>)
    : undefined;
}

/**
 * A projection ahead starts each subject from where the live mix holds it, its `since` worked out
 * again where it was still ahead, since the copy's clock may have moved it.
 */
function carry<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  c: Mixer<I, O>,
  copy: Voice<I, O>,
): Subject<unknown> | undefined {
  const live = recordOf(mix, voice, subject);
  if (live === undefined) return undefined;
  const h = copyHeld(voice, live);
  if (h.reaches && !(h.since <= mix.now)) {
    h.since = c.sinceOf(copy, h.delay);
    h.shown = c.shownOf(copy, h.since);
  }
  h.from = h.stepped;
  return h;
}

/**
 * A projection back starts each subject from the latest copy kept at or before `t`, else from its
 * voice's start with fresh state, which is exact for a voice stepped at a fixed interval.
 */
export function recall<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  t: number,
  cut: Cut,
  c?: Mixer<I, O>,
  copy?: Voice<I, O>,
): Subject<unknown> | undefined {
  const live =
    voice.left?.at(subject, cut) ??
    heldAt(voice, subject, recordOf(mix, voice, subject), t, cut.seq);
  if (live === undefined) return undefined;
  const snap = live.snaps && last(live.snaps, t, true);
  if (snap) {
    const h = copyHeld(voice, snap.held);
    // A start still ahead when the copy was kept may have moved before `t`, with no copy between.
    if (c !== undefined && copy !== undefined && !(h.since <= snap.at)) origin(c, copy, h);
    h.from = h.stepped;
    h.replay = live.inputs;
    return h;
  }
  // Its origin by the controls the voice had then: a seek or an anchor has moved a waiting
  // voice's since.
  const since = c === undefined || copy === undefined ? live.since : c.sinceOf(copy, live.delay);
  const h = record(
    voice,
    live.reaches,
    live.reaches && voice.patch.state
      ? (voice.patch.state(subject) as unknown)
      : (undefined as unknown),
  );
  h.delay = live.delay;
  h.since = since;
  h.shown = c === undefined || copy === undefined ? live.shown : c.shownOf(copy, since);
  const fresh = meet(mix, voice, h, t);
  h.rebuilt = voice.rebuilds;
  h.from = h.stepped;
  h.unknown = voice.spec.from === 'current' || fresh;
  h.replay = live.inputs;
  return h;
}

/** Per channel, the least sure voice that fed it this frame. */
function doubts<I, O>(mix: Mixer<I, O>, subject: I): { [K in keyof O]-?: Doubt } {
  const out = {} as Record<string, Doubt>;
  for (const name of mix.names) out[name] = 'exact';
  const rank = { exact: 0, stepped: 1, held: 2 } as const;
  // A voice still waiting on an anchor nothing has answered may yet play, or stop, by now.
  for (const voice of mix.cued) {
    const anchor = voice.spec.anchor;
    if (anchor === undefined || voice.state === 'done') continue;
    const waiting =
      (voice.state === 'pending' && !Number.isFinite(voice.start)) ||
      (voice.state !== 'pending' &&
        voice.state !== 'fading' &&
        (anchor.out !== undefined || anchor.end !== undefined) &&
        !Number.isFinite(voice.outAt));
    if (!waiting || !mix.aims(voice, subject)) continue;
    for (const slot of voice.slots) out[mix.names[slot] as string] = 'held';
  }
  const feed = (voice: Voice<I, O>, held: Subject<unknown>) => {
    if (voice.state === 'done' || held.weight <= 0) return;
    const d = doubtOf(mix, voice, held);
    for (const slot of voice.slots) {
      const name = mix.names[slot] as string;
      if (rank[d] > rank[out[name] as Doubt]) out[name] = d;
    }
  };
  for (let held: Subject<unknown> | null = mix.chain(subject); held !== null; held = held.next)
    if (held.voice !== null) feed(held.voice as Voice<I, O>, held);
  // A voice sharing one record is in no chain; its record holds the weight the fold just gave.
  for (const voice of mix.sharers)
    if (voice.everyone !== null && voice.state !== 'pending') feed(voice, voice.everyone);
  return out as { [K in keyof O]-?: Doubt };
}

function doubtOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, held: Subject<unknown>): Doubt {
  const weight = voice.spec.weight;
  if (held.unknown) return 'held';
  // A weight read back from a recording is what the mix used then, so its signal's state is moot.
  const replayed = held.replay !== undefined && last(held.replay, mix.now, true) !== undefined;
  if (typeof weight === 'function' && weight.input && !replayed) return 'held';
  if (voice.owner !== null && heldByInput(voice)) return 'held';
  const reads = voice.patch.reads;
  if (reads !== undefined && reads.length > 0) {
    const then = mix.hostThen?.fields;
    if (then === undefined || !reads.every((f) => f in then)) return 'held';
  }
  if (mix.now > (held.from ?? mix.now)) {
    const fixed = stepOf(mix, voice) !== undefined;
    // A read ahead reads a signal's state at every known event, and one step across a stretch
    // with none in it is as good as any number; a read back steps it from a copy in one go.
    const kept = held.kept !== null && held.kept.size > 0 && !replayed && mix.backward;
    if ((voice.patch.step && !fixed) || kept) return 'stepped';
  }
  return 'exact';
}
