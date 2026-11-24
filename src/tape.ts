import type { Mixer } from './mixer.js';
import { move, waits } from './move.js';
import type { Pace } from './pace.js';
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
 * The tape `history.tape` makes for a transport, stamping each call with the host time it was made
 * at: rate 0 holds mix time still across frames, and host time tells them apart.
 */
export function tapeOf(transport: Transport): Tape | undefined {
  const make = transport.history?.tape;
  if (make === undefined) return undefined;
  return make(transport, {
    now: () => (Number.isNaN(transport.u) ? Number.NEGATIVE_INFINITY : transport.u),
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
  tape.recordEntry([op], label);
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
 * Makes the recorded calls `due` by the host time each was made at again, each host time's in a
 * frame of its own with every mix on the transport moved to where it stood then, as the host made
 * them. Answers the host time of the last frame it played, NaN for none. Given `onto` and the
 * stage of its copies, it makes them on those, and the caller puts the tape back. `lands` is a
 * sync's own frame landing what waits with the mix clock standing still, as a rebase's does.
 */
export function replay(
  transport: Transport,
  due: (u: number) => boolean,
  onto: Transport = transport,
  on: Stage = live,
  lands = false,
): number {
  const tape = transport.tape;
  if (tape === undefined) return Number.NaN;
  const u = onto.u;
  let last = Number.NaN;
  try {
    for (;;) {
      const at = tape.timestampAt(tape.undoDepth());
      if (at === undefined || !due(at)) return last;
      if (at !== last) {
        last = at;
        onto.u = at;
        const now = onto.pace === null ? at : onto.pace.reading(at);
        // The frame begins before the mixes move, as a sync's does, so a voice that ends moving
        // there leaves in this frame, not the one before.
        const later = now > onto.now;
        onto.tick(later ? now : onto.now);
        // Host time moved to `at` while the rate held the mix clock, or this is a rebasing sync's
        // own frame: either lands what waits, as a sync there does.
        const held = (now === onto.now && onto.pace !== null) || (lands && at === u);
        for (const m of onto.members) if (later || (held && waits(m))) move(m, now);
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
