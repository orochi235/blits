import { move } from './move.js';
import type { Pace } from './pace.js';
import type { Transport } from './transport.js';
import type { Tape, TapeOp } from './types.js';

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

/** Records a host call, which `again` makes once more when the mix plays past it after a seek. */
export function record(
  on: {
    readonly tape: Tape | undefined;
    readonly replaying: boolean;
    readonly projecting: boolean;
  },
  label: string,
  again: () => void,
): void {
  const tape = on.tape;
  if (tape === undefined || on.replaying || on.projecting) return;
  const op: TapeOp = {
    label,
    apply() {
      again();
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
 * Makes the recorded calls `due` by the host time each was made at again, each host time's in a
 * frame of its own with every mix on the transport moved to where it stood then, as the host made
 * them. Answers the host time of the last frame it played, NaN for none.
 */
export function replay(transport: Transport, due: (u: number) => boolean): number {
  const tape = transport.tape;
  if (tape === undefined) return Number.NaN;
  const u = transport.u;
  let last = Number.NaN;
  try {
    for (;;) {
      const at = tape.timestampAt(tape.undoDepth());
      if (at === undefined || !due(at)) return last;
      if (at !== last) {
        last = at;
        transport.u = at;
        const now = transport.pace === null ? at : transport.pace.reading(at);
        if (now > transport.now) for (const m of transport.members) move(m, now);
        transport.tick(transport.now);
      }
      transport.replaying = true;
      try {
        tape.redo();
      } finally {
        transport.replaying = false;
      }
    }
  } finally {
    transport.u = u;
  }
}
