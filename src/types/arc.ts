import type { Handle, OwnerSpec, VoiceSpec } from './voice.js';

/**
 * One voice of an arc's part. It is a voice's spec, less what the arc sets for it. The arc places
 * it, fades it across each boundary by `blend`, and holds its first and last frames for the blend.
 *
 * @category score
 */
export interface ArcVoice<I, O, H = unknown>
  extends Omit<
    VoiceSpec<I, O, H>,
    | 'owner'
    | 'start'
    | 'anchor'
    | 'freeze'
    | 'fade'
    | 'faster'
    | 'slower'
    | 'overlap'
    | 'ballast'
    | 'priority'
    | 'earliest'
    | 'rank'
  > {
  /**
   * How long the part holds the arc, ms on the arc's clock. Default: the patch's duration times
   * its passes, which leaves out a `stagger`, so a part whose last subject lands later says so here.
   */
  duration?: number;
}

/**
 * One part of an arc. It is a voice, or several layered together that play as one and last as
 * long as the longest.
 *
 * @category score
 */
export type ArcPart<I, O, H = unknown> = ArcVoice<I, O, H> | readonly ArcVoice<I, O, H>[];

/**
 * What `arc` takes. It is an owner over three parts that hand over in order, `enter`, `active`
 * and `exit`, any of which may be left out.
 *
 * @category score
 */
export interface ArcSpec<I, O, H = unknown> extends Omit<OwnerSpec<I, H>, 'freeze'> {
  /** What plays as it arrives. Its end is the arc's `in` mark. */
  enter?: ArcPart<I, O, H>;
  /** What plays between the two, over the hold. Its end is the arc's `coast` mark. */
  active?: ArcPart<I, O, H>;
  /** What plays as it leaves. Its start is the arc's `out` mark, and its end the arc's `end`. */
  exit?: ArcPart<I, O, H>;
  /**
   * How long `active` plays, ms on the arc's clock, or `'open'`. A number loops `active` for it
   * unless its `loop` says how many passes; `'open'` plays it until `release`. Default: `active`'s
   * own length, held open where it loops for good, and 0 with no `active`.
   */
  hold?: number | 'open';
  /** A crossfade across each boundary, ms, half before it and half after. Default 0. */
  blend?: number;
}

/**
 * An arc's handle, which can release its hold. It is an owner's handle, and `release` ends the
 * hold. `fade` takes it out with no exit.
 *
 * @category score
 */
export interface ArcHandle<I = unknown> extends Handle<I> {
  /**
   * Ends the hold now and plays the exit. Its blend starts here; where the enter is still
   * playing, the exit follows it. Nothing once the exit has begun or the arc is fading.
   */
  release(): void;
}
