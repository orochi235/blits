import type { ArcVoice } from './arc.js';
import type { Easing, Patch } from './patch.js';
import type { Anchor } from './place.js';
import type { FadeSpec, Handle } from './voice.js';

/**
 * A value that survives `JSON.stringify` and `JSON.parse` unchanged.
 *
 * @category show
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/**
 * An easing as data: a name or a shape, never a function.
 *
 * @category show
 */
export type Ease = Exclude<Easing, (u: number) => number>;

/**
 * A cue's ramps in and out, ms, as a voice's {@link FadeSpec} with its curve as data.
 *
 * @category show
 */
export interface Fade extends Omit<FadeSpec, 'ease'> {
  ease?: Ease;
}

/**
 * What every cue takes.
 *
 * @category show
 */
export interface CueBase {
  /** What other cues' anchors call it by. */
  name?: string;
  /** Ms on the show's clock, or an anchor to another cue. Default 0. */
  start?: number | Anchor;
  fade?: Fade;
  /** Cues it at weight 0: anchors to it still answer, and its handle's `weight` unmutes it. */
  muted?: boolean;
}

/**
 * A cue that plays one kind: its factory's voices, placed and faded as one.
 *
 * @category show
 */
export interface KindCue extends CueBase {
  /** Which of `play`'s kinds makes its voices. */
  kind: string;
  /** What the kind is handed. */
  params?: { readonly [key: string]: Json };
  /**
   * How long it lasts, ms from its start, its fade out ending there. At most one of this and
   * `end`. With neither it lasts to the show's `duration` where its start is a number, and
   * otherwise as long as its patch.
   */
  length?: number;
  /** Where it ends, on the show's clock or as an anchor, its fade out ending there. */
  end?: number | Anchor;
  /**
   * The curve its phase runs through: its voices' {@link VoiceSpec.remap | `remap`} curve. Any patch
   * but a motion, which takes no remap.
   */
  ease?: Ease;
  /** As a voice's {@link VoiceSpec.freeze | `freeze`}. One freezing after has no end of its own: it stays until the show is stopped. */
  freeze?: 'before' | 'after' | 'both';
}

/**
 * One kind in one part of an arc cue.
 *
 * @category show
 */
export interface Piece {
  kind: string;
  params?: { readonly [key: string]: Json };
  /** How long it holds its part, as an arc voice's {@link ArcVoice.duration | `duration`}. */
  length?: number;
  /** The curve its phase runs through, as a kind cue's `ease`. */
  ease?: Ease;
}

/**
 * A cue that plays as `mix.arc` does: an enter, an active held for `hold`, and an exit, each a
 * piece or several layered.
 *
 * @category show
 */
export interface ArcCue extends CueBase {
  enter?: Piece | readonly Piece[];
  active?: Piece | readonly Piece[];
  exit?: Piece | readonly Piece[];
  /** As an arc's {@link ArcSpec.hold | `hold`}. */
  hold?: number | 'open';
  /** As an arc's {@link ArcSpec.blend | `blend`}. */
  blend?: number;
}

/**
 * One timed unit of a show.
 *
 * @category show
 */
export type Cue = KindCue | ArcCue;

/**
 * A list of cues as plain data, which round-trips through JSON. `play` schedules it on a mix.
 *
 * @category show
 */
export interface Show {
  name?: string;
  /** The host's length for it, ms. `play` reads it only as a kind cue's default end. */
  duration?: number;
  cues: readonly Cue[];
}

/**
 * One voice a kind makes: a voice's spec, less what the cue sets for it.
 *
 * @category show
 */
export type KindVoice<I, O, H = unknown> = Omit<ArcVoice<I, O, H>, 'duration'>;

/**
 * What a kind is handed besides its params.
 *
 * @category show
 */
export interface KindInput {
  /** How long the cue lasts, ms; undefined where nothing in the show says. */
  length: number | undefined;
  /** The cue, or for an arc cue the piece, it is making voices for. */
  cue: KindCue | Piece;
}

/**
 * Turns a cue's params into what data cannot carry: a patch, or voices with their subjects and
 * weights, several of which play layered.
 *
 * @category show
 */
export type Kind<I, O, H = unknown> = (
  params: { readonly [key: string]: Json },
  input: KindInput,
  // biome-ignore lint/suspicious/noExplicitAny: a patch naming no host fits a mix naming one
) => Patch<I, O, any, H> | KindVoice<I, O, H> | readonly KindVoice<I, O, H>[];

/**
 * A playing show: the owner every cue plays under, and each cue's own handles.
 *
 * @category show
 */
export interface ShowHandle<I = unknown> extends Handle<I> {
  /**
   * Per cue, in show order, the handles of the voices it cued: one, several where its kind layered
   * them, or an arc cue's `ArcHandle`.
   */
  readonly cues: readonly (readonly Handle<I>[])[];
}
