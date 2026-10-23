import type { Handle, OwnerSpec, VoiceSpec } from './voice.js';

/**
 * One voice of an arc's part: a voice's spec, less what the arc sets for it. The arc places it,
 * fades it across each boundary by `blend`, and holds its first and last frames for the blend.
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
 * One part of an arc: a voice, or several layered together that play as one and last as long as
 * the longest.
 *
 * @category score
 */
export type ArcPart<I, O, H = unknown> = ArcVoice<I, O, H> | readonly ArcVoice<I, O, H>[];

/**
 * What `arc` takes: an owner over three parts that hand over in order, `enter`, `active` and
 * `exit`, any of which may be left out.
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
   * How long `active` plays, ms on the arc's clock, looping for it unless its `loop` says how many
   * passes; or `'open'`, until `release`. Default: `active`'s own length, held open where it loops
   * for good, and 0 with no `active`.
   */
  hold?: number | 'open';
  /** A crossfade across each boundary, ms, half before it and half after. Default 0. */
  blend?: number;
}

/**
 * An arc's handle: an owner's, and the release of its hold. `fade` takes it out with no exit.
 *
 * @category score
 */
export interface ArcHandle<I = unknown> extends Handle<I> {
  /**
   * Ends the hold now and plays the exit, its blend starting here; where the enter is still
   * playing, the exit follows it. Nothing once the exit has begun or the arc is fading.
   */
  release(): void;
}
