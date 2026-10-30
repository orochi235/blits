import { copyAhead, mirror, playAhead, recordOf, type Stages } from './ahead.js';
import { ownBlends } from './blend.js';
import { heldAt } from './chain.js';
import { stepOf } from './clock.js';
import { type Cut, within } from './cut.js';
import { fadesAt } from './fade.js';
import { meet, origin } from './held.js';
import { copyHeld, last, lastWithin } from './history.js';
import { Mixer } from './mixer.js';
import { heldByInput, relink } from './owner.js';
import { reading } from './reading.js';
import { record } from './record.js';
import { recount } from './roster.js';
import { copyStanding, stands } from './standing.js';
import type { Subject } from './subject.js';
import { hostAhead, hostAt } from './tape.js';
import { type Frame, Transport } from './transport.js';
import type { Doubt, Mix, Projection, TransportProjection } from './types.js';
import { cover, coverFrame } from './unpage.js';
import type { Controls, Voice } from './voice.js';

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
  let u = ahead ? hostAhead(transport, t) : hostAt(transport, t);
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
    copy.places = mix.places;
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
  const back = !ahead && kept ? cut : null;
  const read = <T>(f: () => T): T => {
    reading.live = false;
    reading.ahead = stood.ahead.size > 0 ? stood.ahead : null;
    reading.back = back;
    try {
      return f();
    } finally {
      reading.live = true;
      reading.ahead = null;
      reading.back = null;
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
      // Its own, which a fade the copy plays out writes to.
      if (v.parts !== null) copy.parts = new Map(v.parts);
      if (v.parted !== null) copy.parted = new Map(v.parted);
      if (v.left !== null) fadesAt(copy, v.left.after(cut), cut.seq);
      if (copy.parted !== null)
        for (const [subject, p] of copy.parted) {
          // A ramp that has ended since was still running at `t`.
          if (p.ramp === undefined || !(t < p.at)) continue;
          copy.parts ??= new Map();
          copy.parts.set(subject, p.ramp);
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
  for (const copy of c.cued) copy.state = copy.stateAt(t);
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
  // A seek stepped it from a copy, and what it keeps now goes on from there.
  if (held.copied && held.kept !== null && held.kept.size > 0 && !replayed) return 'stepped';
  return 'exact';
}
