import { ownBlends } from './blend.js';
import { index } from './chain.js';
import { copyHeld, last, lastWithin, leftAt } from './history.js';
import { Mixer } from './mixer.js';
import { move } from './move.js';
import { heldByInput, ownerReading, relink } from './owner.js';
import { pin } from './place.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import { hostAt } from './tape.js';
import { type Cut, Transport, within } from './transport.js';
import type { Doubt, Mix, Projection, TransportProjection } from './types.js';
import { cover } from './unpage.js';
import { unreached } from './unreached.js';
import type { Controls, Subject, Voice } from './voice.js';

/**
 * Every mix on a transport read at mix time `t`, through copies of them on a transport of their
 * own, moved together so an anchor across mixes answers as it would live.
 */
export function projectAll(transport: Transport, t: number): TransportProjection {
  const ahead = Number.isNaN(transport.now) || t >= transport.now;
  const tape = transport.tape;
  const stamp = ahead && tape !== undefined ? tape.timestampAt(tape.undoDepth()) : undefined;
  const pace = transport.pace;
  const next = stamp === undefined || pace === null ? stamp : pace.reading(stamp);
  if (next !== undefined && next <= t)
    throw new Error(
      `blits: the tape holds calls at ${next} that a read ahead to ${t} cannot play; seek there to see them`,
    );
  // Behind, the last frame at or before `t`, read as it showed when `t` is that frame's own time.
  let cut: Cut = { seq: transport.seq, strict: false };
  let u = hostAt(transport, t);
  if (!ahead) {
    const history = transport.history;
    if (!history) throw new Error('blits: reading back needs a mix made with history');
    cover(transport, t);
    const frame = transport.frameAt(t);
    if (frame !== undefined) {
      cut = { seq: frame.seq, strict: frame.at === t };
      if (frame.at === t) u = frame.u;
    }
  }
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
    const copy = new Mixer<unknown, unknown>(mix.kit, {
      ...mix.opts,
      history: undefined,
      lanes: false,
      transport: c,
    });
    copy.slot = mix.slot;
    copy.projecting = true;
    copies.set(mix, copy);
    if (ahead) copyAhead(mix, copy);
    else copyBack(mix, copy, t, cut);
  }
  if (ahead) for (const copy of copies.values()) move(copy, t);
  const read = <T>(f: () => T): T => {
    reading.live = false;
    try {
      return f();
    } finally {
      reading.live = true;
    }
  };
  return {
    timestamp: t,
    of<I, O, H>(mix: Mix<I, O, H>): Projection<I, O> {
      const copy = copies.get(mix as unknown as Mixer<unknown, unknown>) as Mixer<I, O> | undefined;
      if (copy === undefined) throw new Error('blits: that mix is not on this transport');
      return {
        timestamp: t,
        probe: (subject, out) => read(() => copy.fold(subject, out)),
        assess: (subject) =>
          read(() => {
            copy.fold(subject);
            return doubts(copy, subject);
          }),
      };
    },
  };
}

/** A mix's copy for a read ahead: its voices as they stand, each subject carried from the live one. */
function copyAhead<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>): void {
  c.pose = mix.pose;
  c.wantsPose = mix.wantsPose;
  c.reducedNow = mix.reducedNow;
  c.cued = mix.cued
    .filter((v) => v.state !== 'done')
    .map((v) => {
      const copy: Voice<I, O> = v.copy((subject) => carry(mix, v, subject, c, copy));
      const at = mix.pins?.get(v);
      if (at !== undefined) pin(c, copy, at);
      return copy;
    });
  ownBlends(c.cued);
  if (mix.owners !== null) relink(c.cued);
  count(c);
}

/** A mix's copy for a read back to `t`, cut at `cut`: its voices then, from the controls and copies kept. */
function copyBack<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>, t: number, cut: Cut): void {
  c.pose = mix.pose;
  c.wantsPose = mix.wantsPose;
  c.reducedNow = mix.reducedNow;
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
      const copy = v.copy(
        (subject) => recall(mix, v, subject, t, cut),
        lastWithin(log, cut) ?? (log[0] as Controls),
      );
      if (then !== undefined) copy.setting.host = then;
      return copy;
    });
  ownBlends(c.cued);
  if (mix.owners !== null) relink(c.cued);
  for (const copy of c.cued)
    copy.state = copy.out
      ? 'fading'
      : (copy.owner === null ? t : ownerReading(copy.owner, t)) < copy.start
        ? 'pending'
        : copy.freezesAfter && copy.elapsedAt(t) >= copy.span + copy.latest
          ? 'frozen'
          : 'live';
  count(c);
}

/** Recounts what the fold's shortcuts depend on, for a projection's freshly copied voices. */
function count<I, O>(mix: Mixer<I, O>): void {
  mix.named = new Store<I, Voice<I, O>[]>();
  mix.naming = 0;
  mix.general = [];
  for (const voice of mix.cued) index(mix, voice);
  mix.loci = mix.cued.filter((v) => v.spec.locus !== undefined).length;
  mix.anchored = mix.cued.filter((v) => v.spec.anchor !== undefined).length;
  mix.steps.push(null, ++mix.version);
}

/** A voice's record of a subject, the one it shares among those it does not reach included. */
function recordOf<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
): Subject<unknown> | undefined {
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
function recall<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  t: number,
  cut: Cut,
): Subject<unknown> | undefined {
  const live = leftAt(voice.left, subject, cut) ?? recordOf(mix, voice, subject);
  if (live === undefined) return undefined;
  const snap = live.snaps && last(live.snaps, t, true);
  if (snap) {
    const h = copyHeld(voice, snap.held);
    h.from = h.stepped;
    h.replay = live.inputs;
    return h;
  }
  const stepped = live.since < t ? live.since : t;
  return {
    reaches: live.reaches,
    delay: live.delay,
    since: live.since,
    shown: live.shown,
    weight: 0,
    rested: false,
    bands: null,
    state:
      live.reaches && voice.patch.state
        ? (voice.patch.state(subject) as unknown)
        : (undefined as unknown),
    stepped,
    ticks: 0,
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    rebuilt: voice.rebuilds,
    kept: null,
    voice,
    next: null,
    version: Number.NaN,
    loci: null,
    slot: -1,
    from: stepped,
    unknown: voice.spec.from === 'current',
    replay: live.inputs,
  };
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
  for (let held: Subject<unknown> | null = mix.chain(subject); held !== null; held = held.next) {
    const voice = held.voice as Voice<I, O> | null;
    if (voice === null || voice.state === 'done') continue;
    if (held.weight <= 0) continue;
    const d = doubtOf(mix, voice, held);
    for (const slot of voice.slots) {
      const name = mix.names[slot] as string;
      if (rank[d] > rank[out[name] as Doubt]) out[name] = d;
    }
  }
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
    const tick = mix.opts.stepMs;
    const fixed = tick !== undefined && tick > 0 && !mix.reducedNow;
    if ((voice.patch.step && !fixed) || (held.kept !== null && held.kept.size > 0 && !replayed))
      return 'stepped';
  }
  return 'exact';
}
