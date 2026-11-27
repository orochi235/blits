import type { Mixer } from './mixer.js';
import { move, waits } from './move.js';
import type { Pace } from './pace.js';
import { HELD, type Stamp } from './stamps.js';
import type { Transport } from './transport.js';
import type { Tape, TapeOp } from './types.js';

/**
 * Where a recorded call is made again: on the mixes the host made it on, or, for a read ahead, on
 * its copies of them.
 */
export interface Stage {
  transport(of: Transport): Transport;
  /** The mix standing for `of`; undefined where a read ahead has no copy of it. */
  mix<I, O>(of: Mixer<I, O>): Mixer<I, O> | undefined;
}

const live: Stage = { transport: (of) => of, mix: (of) => of };

/** The stage the tape is playing calls on; the live one outside a read ahead's replay. */
let stage = live;
/** What a call threw on a read ahead's stage, for `replay` to throw once the tape has the entry back. */
let failed: { error: unknown } | undefined;
/** The mixes whose frame read after a call a read ahead's stage has made again, since `takeFramed`. */
let shown = new Set<Mixer<unknown, unknown>>();

/**
 * The mixes whose frame at the time of the calls a read ahead's stage made since the last ask read
 * after one of them, so that time was a frame there; and forgets them.
 */
export function takeFramed(): ReadonlySet<Mixer<unknown, unknown>> {
  const out = shown;
  if (out.size > 0) shown = new Set();
  return out;
}

/** Refuses a recorded call a read ahead's copies cannot take. */
export function unplayable(what: string): never {
  throw new Error(
    `blits: the tape holds ${what}, which a read ahead cannot play; seek there to see it`,
  );
}

/** What a recorded call's `invert` gives: a mix goes back by restoring, never by undoing a call. */
const undone: TapeOp = { apply() {}, invert: () => undone };

/**
 * The tape `history.tape` makes for a transport, stamping each call as `Stamps` does: by the host
 * time it was made at, rising past every stamp before.
 */
export function tapeOf(transport: Transport): Tape | undefined {
  const make = transport.history?.tape;
  if (make === undefined) return undefined;
  return make(transport, {
    now: () => transport.stamps.current,
    branching: true,
    coalesceWindowMs: 0,
  });
}

interface Recorder {
  readonly members?: readonly Mixer<unknown, unknown>[];
  readonly tape: Tape | undefined;
  readonly replaying: boolean;
  readonly projecting: boolean;
}

/** Whether `record` keeps a call made on `on` now, so a caller can skip making one it would drop. */
export function taping(on: Recorder): boolean {
  return on.tape !== undefined && !on.replaying && !on.projecting;
}

/**
 * Records a host call, which `again` makes once more when the mix plays past it after a seek, or
 * when a read ahead does, on the stage it is given.
 */
export function record(on: Recorder, label: string, again: (stage: Stage) => void): void {
  const tape = on.tape;
  if (tape === undefined || !taping(on)) return;
  // A call made before anything read its mix this frame shows in that frame's read.
  const before = (on.members ?? [on as unknown as Mixer<unknown, unknown>]).filter(
    (m) => m.syncing || !m.looked,
  );
  const op: TapeOp = {
    label,
    apply() {
      if (stage === live) {
        again(stage);
        return;
      }
      for (const m of before) shown.add(m);
      // Thrown inside the tape's `redo`, it would leave the tape without the entry.
      try {
        again(stage);
      } catch (e) {
        failed ??= { error: e };
      }
    },
    invert: () => undone,
  };
  const t = (on as { transport?: Transport }).transport ?? (on as unknown as Transport);
  t.stamps.mint(madeTo(tape), { at: t.now, u: t.u, seq: t.seq, jump: label === 'jump' });
  tape.recordEntry([op], label);
}

/** Where the next call the tape holds ahead was made; undefined with none ahead. */
export function nextStamp(transport: Transport): Stamp | undefined {
  const tape = transport.tape;
  if (tape === undefined) return undefined;
  const k = tape.timestampAt(tape.undoDepth());
  return k === undefined ? undefined : transport.stamps.of(madeTo(tape), k);
}

/** The stamp of the last call the tape has made, so a frame knows where on the tape it began. */
export function madeTo(tape: Tape | undefined): number {
  if (tape === undefined) return Number.NEGATIVE_INFINITY;
  return tape.timestampAt(tape.undoDepth() - 1) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Begins a frame on `onto` at host time `at` and mix time `now`, and moves its mixes there. The
 * frame begins before they move, as a sync's does, so a voice that ends moving there leaves in this
 * frame, not the one before. Host time moving while the rate holds the clock lands what waits, as a
 * sync there does, and so does a rebasing sync's own frame, `lands`.
 */
function begin(onto: Transport, at: number, now: number, lands: boolean): void {
  onto.u = at;
  const later = now > onto.now;
  onto.tick(later ? now : onto.now);
  const held = (now === onto.now && onto.pace !== null) || lands;
  for (const m of onto.members) if (later || (held && waits(m))) move(m, now);
}

/** The host time at which the mix clock reads `t`, under the rate it has now. */
export function hostAt(clock: { readonly pace: Pace | null }, t: number): number {
  return clock.pace === null ? t : clock.pace.timeOf(t);
}

/**
 * The host time a move ahead to mix time `t` lands at: never behind the clock's own, since rate 0
 * reads `t` at every host time from the earliest `hostAt` gives, and a call stamped earlier than
 * one already on the tape would cut it out of order.
 */
export function hostAhead(
  clock: { readonly pace: Pace | null; readonly u: number },
  t: number,
): number {
  const at = hostAt(clock, t);
  return clock.u > at ? clock.u : at;
}

/**
 * Makes the recorded calls `due` by where each was made again, each frame's in a frame of its own
 * with every mix on the transport moved to the mix time it stood at then, as the host made them.
 * A frame plays at its own host time where the clock has not passed it, and a held step on
 * otherwise; where the clock reads another mix time there, a jump since parted them, and it is
 * made to read the recorded one. Answers the host time of the last frame it played, NaN for none.
 * Given `onto` and the stage of its copies, it makes them on those, and the caller puts the tape
 * back. `lands` is a sync's own frame landing what waits with the mix clock standing still, as a
 * rebase's does.
 */
export function replay(
  transport: Transport,
  due: (s: Stamp) => boolean,
  onto: Transport = transport,
  on: Stage = live,
  lands = false,
): number {
  const tape = transport.tape;
  if (tape === undefined) return Number.NaN;
  const u = onto.u;
  let last = Number.NaN;
  let seq = Number.NaN;
  try {
    for (;;) {
      const k = tape.timestampAt(tape.undoDepth());
      if (k === undefined) return last;
      const s = transport.stamps.of(madeTo(tape), k);
      if (!due(s)) return last;
      if (s.seq !== seq) {
        seq = s.seq;
        // A jump left the frame the host made it in, a held step before it, which plays first.
        const from = s.u - HELD;
        if (s.jump && from > onto.ticked && transport.drive === null) {
          last = from;
          begin(
            onto,
            from,
            onto.pace === null ? from : onto.pace.reading(from),
            lands && from === u,
          );
        }
        // Off the recorded run, its host time says nothing of where the clock stands.
        const off = s.u <= onto.ticked;
        const at = off ? onto.ticked + HELD : s.u;
        last = at;
        onto.u = at;
        let now = onto.pace === null ? at : onto.pace.reading(at);
        if (
          (off || s.jump || transport.drive !== null) &&
          now !== s.at &&
          s.at > Number.NEGATIVE_INFINITY
        ) {
          // A jump on the recorded run held the clock, any ramp with it, for a step before it landed.
          onto.fix(s.at, s.jump && !off && transport.drive === null ? from : at);
          now = s.at;
        }
        // The jump moved host time on a held step past the host's own clock; so does its replay.
        if (s.jump) onto.lag += HELD;
        begin(onto, at, now, lands && at === u);
      }
      transport.replaying = true;
      stage = on;
      try {
        tape.redo();
      } finally {
        transport.replaying = false;
        stage = live;
      }
      if (failed !== undefined) {
        const { error } = failed;
        failed = undefined;
        throw error;
      }
    }
  } finally {
    onto.u = u;
  }
}
