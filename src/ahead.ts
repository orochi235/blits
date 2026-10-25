import { ownBlends } from './blend.js';
import { headOf } from './chain.js';
import { open, sighted, weightAt } from './everyone.js';
import { copyHeld, unread } from './history.js';
import { markOf, voiceMarks } from './marks.js';
import { Mixer } from './mixer.js';
import { move } from './move.js';
import { relink } from './owner.js';
import { pin, place } from './place.js';
import { recount } from './roster.js';
import { hostAhead, replay } from './tape.js';
import { Transport } from './transport.js';
import type { Tape } from './types.js';
import { unreached } from './unreached.js';
import type { Subject, Voice } from './voice.js';

/** A live mix's copies at each known event a read ahead stopped at, and the subjects read there. */
export interface Stages {
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
export function playAhead(
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
  c.u = hostAhead(c, to);
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
    c.u = Math.max(last, hostAhead(c, to));
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
export function copyAhead<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>): void {
  mirror(mix, c);
  c.cued = mix.cued
    .filter((v) => v.state !== 'done')
    .map((v) => {
      const link = {
        mix,
        voice: v,
        up: links.get(v),
        seen: 0,
        shared: false,
        filled: false,
      } as unknown as Link;
      const copy: Voice<I, O> = v.copy((subject) => carry(link, subject, c, copy), undefined, true);
      link.seen = copy.seen;
      link.shared = copy.sharing;
      links.set(copy, link);
      const at = mix.pins?.get(v);
      if (at !== undefined) pin(c, copy, at);
      return copy;
    });
  c.waking = mix.waking;
  ownBlends(c.cued);
  // A copy keeps no list of owners, so the one before says only by its voices.
  if (mix.owners !== null || (mix.projecting && c.cued.some((v) => v.holding !== null)))
    relink(c.cued);
  recount(c);
}

/** Gives a projection's copy what it reads of the live mix as it is, before its voices are copied. */
export function mirror<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>): void {
  c.pose = mix.pose;
  c.wantsPose = mix.wantsPose;
  c.reducedNow = mix.reducedNow;
}

/** A voice's record of a subject, the one it shares among those it does not reach included. */
export function recordOf<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
): Subject<unknown> | undefined {
  // A voice sharing one record has that for every subject a chain has asked it about, pointed at
  // the subject for the caller to copy from.
  if (voice.sharing) {
    const slot = headOf(mix, subject)?.slot ?? -1;
    if (!sighted(voice, slot)) return undefined;
    const all = voice.everyone as Subject<unknown>;
    open(voice, all, slot);
    all.weight = weightAt(voice, slot);
    return all;
  }
  const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
  if (held !== undefined || voice.unreachedBits === null) return held;
  return unreached(voice, headOf(mix, subject)?.slot ?? -1)
    ? (voice.unreached as Subject<unknown>)
    : undefined;
}

/** Where a read ahead's copy of a voice came from, and how it stood when it was made. */
interface Link {
  mix: Mixer<unknown, unknown>;
  voice: Voice<unknown, unknown>;
  /** The link of `voice`, where it is itself a copy at the stop before. */
  up: Link | undefined;
  /** The copy's `seen` and `sharing` as it was made. */
  seen: number;
  shared: boolean;
  /** Whether the copy has taken a record from `voice`. */
  filled: boolean;
}

/** Each read ahead copy's link, by the copy. */
const links = new WeakMap<object, Link>();

/**
 * Whether a read ahead's copy of a voice holds a record only where the copy it was made from does:
 * it has met no subject, taken no record, shares none, and reaches none it was asked about.
 */
function empty(voice: Voice<unknown, unknown>, link: Link): boolean {
  return (
    voice.seen === link.seen &&
    !link.filled &&
    !link.shared &&
    voice.unreached === null &&
    voice.unreachedBits === null
  );
}

/**
 * Whether a subject's record on a read ahead's copy at a stop can go on to the copy at the next
 * stop as it is: each stop reads a subject once, before the next carries it on, and nothing reads
 * the record there again. Not one a voice shares among subjects, or one the live mix holds.
 */
function handable<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, h: Subject<unknown>): boolean {
  return mix.projecting && h.reaches && !voice.sharing && h !== voice.unreached;
}

/** A record handed on as `copyHeld` would copy it, its place in the stop's chain let go. */
function handOn(h: Subject<unknown>): Subject<unknown> {
  h.restored = null;
  return unread(h);
}

/**
 * A projection ahead starts each subject from where the live mix holds it, its `since` worked out
 * again where it was still ahead, since the copy's clock may have moved it.
 */
function carry<I, O>(
  link: Link,
  subject: I,
  c: Mixer<I, O>,
  copy: Voice<I, O>,
): Subject<unknown> | undefined {
  const mix = link.mix as unknown as Mixer<I, O>;
  const voice = link.voice as unknown as Voice<I, O>;
  // A voice starting many stops on would otherwise ask every copy before it, one by one. Where
  // the first copy that may hold one has none, each copy after it has none, dropped or not.
  let from = link;
  while (from.up !== undefined && empty(from.voice, from.up)) from = from.up;
  if (from !== link && recordOf(from.mix, from.voice, subject as unknown) === undefined)
    return undefined;
  const live = recordOf(mix, voice, subject);
  if (live === undefined) return undefined;
  const h = handable(mix, voice, live) ? handOn(live) : copyHeld(voice, live);
  if (h.reaches && !(h.since <= mix.now)) {
    h.since = c.sinceOf(copy, h.delay);
    h.shown = c.shownOf(copy, h.since);
  }
  h.from = h.stepped;
  link.filled = true;
  return h;
}
