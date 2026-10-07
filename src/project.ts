import { ownBlends } from './blend.js';
import { index } from './chain.js';
import { copyHeld, last } from './history.js';
import type { Mixer } from './mixer.js';
import { move } from './move.js';
import { heldByInput, ownerReading, relink } from './owner.js';
import { pin } from './place.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import { hostAt } from './tape.js';
import type { Doubt, Projection } from './types.js';
import { unreached } from './unreached.js';
import type { Controls, Subject, Voice } from './voice.js';

/** A projection to mix time `t` through `c`, a mixer of its own the mix has just made. */
export function project<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>, t: number): Projection<I, O> {
  const u = hostAt(mix, t);
  const pace = mix.pace;
  c.projecting = true;
  c.pose = mix.pose;
  c.offset = mix.offset;
  c.u = u;
  c.wantsPose = mix.wantsPose;
  c.nextId = mix.nextId;
  c.reducedNow = mix.reducedNow;
  if (Number.isNaN(mix.now) || t >= mix.now) {
    c.now = mix.now;
    c.pace = pace === null ? null : pace.until(Number.POSITIVE_INFINITY);
    c.cued = mix.cued
      .filter((v) => v.state !== 'done')
      .map((v) => {
        const copy = v.copy((subject) => carry(mix, v, subject));
        const at = mix.pins?.get(v);
        if (at !== undefined) pin(c, copy, at);
        return copy;
      });
    ownBlends(c.cued);
    if (mix.owners !== null) relink(c.cued);
    c.announced = mix.announced.map((a) => ({ ...a }));
    count(c);
    move(c, t);
  } else {
    const history = mix.opts.history;
    if (!history) throw new Error('blits: reading back needs a mix made with history');
    if (t < mix.now - history.ms)
      throw new Error(`blits: ${t} is older than this mix's history reaches`);
    c.now = t;
    c.pace = pace === null ? null : pace.until(u);
    c.backward = true;
    const was = last(mix.hostLog, t, true);
    const host = mix.opts.host;
    const then =
      was && typeof host === 'object' && host !== null
        ? Object.assign(Object.create(host) as object, was.fields)
        : undefined;
    if (was) c.hostThen = was;
    c.announced = mix.announced.filter((a) => a.made < t).map((a) => ({ ...a }));
    c.cued = [...mix.cued, ...mix.gone]
      .filter((v) => v.cuedAt <= t && v.doneAt > t)
      .sort((a, b) => a.id - b.id)
      .map((v) => {
        const log = v.log as Controls[];
        const copy = v.copy(
          (subject) => recall(mix, v, subject, t),
          last(log, t, (e) => e.sync) ?? (log[0] as Controls),
        );
        if (then !== undefined) copy.setting.host = then;
        return copy;
      });
    ownBlends(c.cued);
    if (mix.owners !== null) relink(c.cued);
    for (const copy of c.cued)
      copy.state =
        (copy.owner === null ? t : ownerReading(copy.owner, t)) < copy.start
          ? 'pending'
          : copy.out && copy.out.at <= t
            ? 'fading'
            : copy.freezesAfter && copy.elapsedAt(t) >= copy.span + copy.latest
              ? 'frozen'
              : 'live';
    count(c);
  }
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
    probe: (subject, out) => read(() => c.fold(subject, out)),
    assess: (subject) =>
      read(() => {
        c.fold(subject);
        return doubts(c, subject);
      }),
  };
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

/** A projection ahead starts each subject from where the live mix holds it. */
function carry<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
): Subject<unknown> | undefined {
  const live = recordOf(mix, voice, subject);
  if (live === undefined) return undefined;
  const h = copyHeld(voice, live);
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
): Subject<unknown> | undefined {
  const live = recordOf(mix, voice, subject);
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
