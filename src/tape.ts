import { move } from './move.js';
import type { Pace } from './pace.js';
import type { Transport } from './transport.js';
import type { Tape, TapeOp } from './types.js';

/** What a recorded call's `invert` gives: a mix goes back by restoring, never by undoing a call. */
const undone: TapeOp = { apply() {}, invert: () => undone };

/** The tape `history.tape` makes for a transport, stamping each call with the mix time it was made at. */
export function tapeOf(transport: Transport): Tape | undefined {
  const make = transport.history?.tape;
  if (make === undefined) return undefined;
  return make(transport, {
    now: () => (Number.isNaN(transport.now) ? Number.NEGATIVE_INFINITY : transport.now),
    branching: true,
    coalesceWindowMs: 0,
  });
}

/** Records a host call, which `again` makes once more when the mix plays past it after a seek. */
export function record(
  on: { readonly tape: Tape | undefined; readonly replaying: boolean; readonly projecting: boolean },
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
 * Makes the recorded calls due by mix time `to()` again, each with every mix on the transport
 * moved to the time it was made at, as the host made it then. `to` is asked again after every
 * call, since a call may change the rate and so where a host time lands.
 */
export function replay(transport: Transport, to: () => number): void {
  const tape = transport.tape;
  if (tape === undefined) return;
  const u = transport.u;
  try {
    for (;;) {
      const at = tape.timestampAt(tape.undoDepth());
      if (at === undefined || !(at <= to())) return;
      if (at > transport.now) {
        transport.u = hostAt(transport, at);
        for (const m of transport.members) move(m, at);
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
