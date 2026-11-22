import type { Subject } from './subject.js';
import type { Channel, OffLane } from './types.js';
import type { Voice } from './voice.js';

/** What a lane fill asks of the mix it belongs to. */
export interface LaneHost<I, O> {
  readonly voices: readonly Voice<I, O>[];
  readonly channels: readonly Channel<unknown>[];
  readonly names: readonly string[];
  /** The mix itself, for its clock: a getter V8 does not inline would box `now` on return. */
  readonly clock: { readonly now: number; readonly frame: number };
  /** Why a voice's patch and spec cannot run on a lane, its channels aside; undefined where they can. */
  unfit(voice: Voice<I, O>): OffLane | undefined;
  /** The voice's record for a subject this probe has already linked it to, from `head` if there. */
  meet(
    voice: Voice<I, O>,
    subject: I,
    head: Subject<unknown> | null,
    slot: number,
  ): Subject<unknown>;
  /** The number `slot` was let go of, to be handed to another subject. */
  forgot(slot: number): void;
  /** The voices whose `subjects` name the subject, in voice order. */
  naming(subject: I): readonly Voice<I, O>[] | undefined;
  /** The subject's number, -1 where it has none yet. */
  slotOf(subject: I): number;
  /** The voice's own fade for a subject whose delay ran out at `since`. */
  envelope(voice: Voice<I, O>, since: number): number;
  /** What a subject's own ramp out of the voice leaves of its weight, 0..1. */
  parting(voice: Voice<I, O>, subject: I): number;
  /**
   * Fills the voice's setting and the send target for a call to its patch, at the voice time, pass
   * and weight in `Arg.ELAPSED`, `Arg.PASS` and `Arg.WEIGHT`.
   */
  ready(voice: Voice<I, O>, subject: I, held: Subject<unknown>): void;
  /**
   * A voice with a signal weight: the signal's value for a subject the general path has met, at the
   * voice time and pass in `Arg.ELAPSED` and `Arg.PASS`, left in `Arg.WEIGHT` before the fade and
   * ramp `weighed` applies, with the setting filled in for the call; makes the voice stateful if the
   * signal keeps state. `slot` is the subject's number.
   */
  signal(voice: Voice<I, O>, subject: I, held: Subject<unknown>, slot: number): void;
  /** Whether a rest-less channel's contribution passes the band, as the general path decides it. */
  passes(was: boolean | undefined, w: number): boolean;
  /** Sets `reading.horizon` for the voice and a subject delayed `delay` voice ms. */
  horizon(voice: Voice<I, O>, delay: number): void;
  /** Whether the mix keeps history, so a record a patch call changed may need a copy kept. */
  readonly keeps: boolean;
  /** After a patch call, keeps history of a record that grew kept state. */
  after(voice: Voice<I, O>, subject: I, held: Subject<unknown>): void;
  /** A patch call left kept state on a record: the voice is stateful from now on. */
  kept(voice: Voice<I, O>): void;
}
