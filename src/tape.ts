import type { Mixer } from './mixer.js';
import { move } from './move.js';
import type { Tape, TapeOp } from './types.js';

/** What a recorded call's `invert` gives: a mix goes back by restoring, never by undoing a call. */
const undone: TapeOp = { apply() {}, invert: () => undone };

/** The tape `history.tape` makes for a mix, stamping each call with the mix time it was made at. */
export function tapeOf<I, O>(mix: Mixer<I, O>): Tape | undefined {
  const make = mix.opts.history?.tape;
  if (make === undefined) return undefined;
  return make(mix, {
    now: () => (Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now),
    branching: true,
    coalesceWindowMs: 0,
  });
}

/** Records a host call, which `again` makes once more when the mix plays past it after a seek. */
export function record<I, O>(mix: Mixer<I, O>, label: string, again: () => void): void {
  const tape = mix.tape;
  if (tape === undefined || mix.replaying || mix.projecting) return;
  const op: TapeOp = {
    label,
    apply() {
      again();
    },
    invert: () => undone,
  };
  tape.recordEntry([op], label);
}

/** The host time at which the mix clock reads `t`, under the rate the mix has now. */
export function hostAt<I, O>(mix: Mixer<I, O>, t: number): number {
  return mix.pace === null ? t : mix.pace.timeOf(t);
}

/**
 * Makes the recorded calls due by mix time `to()` again, each with the mix moved to the time it was
 * made at, as the host made it then. `to` is asked again after every call, since a call may change
 * the mix's rate and so where a host time lands.
 */
export function replay<I, O>(mix: Mixer<I, O>, to: () => number): void {
  const tape = mix.tape;
  if (tape === undefined) return;
  const u = mix.u;
  try {
    for (;;) {
      const at = tape.timestampAt(tape.undoDepth());
      if (at === undefined || !(at <= to())) return;
      if (at > mix.now) {
        mix.u = hostAt(mix, at);
        move(mix, at);
      }
      mix.replaying = true;
      try {
        tape.redo();
      } finally {
        mix.replaying = false;
      }
    }
  } finally {
    mix.u = u;
  }
}
