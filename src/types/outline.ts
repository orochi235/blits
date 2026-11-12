import type { Placement } from './place.js';
import type { Handle } from './voice.js';

/**
 * What a mix holds, as {@link Mix.describe | `describe`} reads it: plain data a tool can draw the
 * mix's graph from, or send elsewhere, with no live object in it.
 *
 * @category mix
 */
export interface Outline {
  /** The mix's {@link MixOptions.name | `name`}. */
  readonly name: string | undefined;
  /** The kit's channels, in kit order. */
  readonly channels: readonly OutlineChannel[];
  /**
   * The voices {@link Mix.voices | `voices`} lists, in the same order, owners, spans and arcs
   * among them. Each comes after the owner it plays under.
   */
  readonly voices: readonly OutlineVoice[];
}

/**
 * One channel of a mix's kit, as an {@link Outline} lists it.
 *
 * @category mix
 */
export interface OutlineChannel {
  readonly name: string;
  /** The channel's {@link Channel.kind | `kind`}, which names how it folds; undefined for none. */
  readonly kind: string | undefined;
}

/**
 * One voice of a mix, as an {@link Outline} lists it.
 *
 * @category mix
 */
export interface OutlineVoice {
  /** Its handle's {@link Handle.id | `id`}, which `marks` and `book` name it by too. */
  readonly id: number;
  readonly name: string | undefined;
  /** A voice playing a patch, or one cued by `owns`, `span` or `arc`. */
  readonly kind: 'voice' | 'owner' | 'span' | 'arc';
  /** The `id` of the owner, span or arc it plays under; undefined for one on the mix clock. */
  readonly owner: number | undefined;
  /** Which part it plays, for a voice an arc holds; undefined for any other. */
  readonly part: 'enter' | 'active' | 'exit' | undefined;
  readonly state: Handle['state'];
  /** The channels its patch writes, in kit order; none for an owner. */
  readonly writes: readonly string[];
  /** The role it plays, from its `role` or a tag the mix's `roles` names. */
  readonly role: string | undefined;
  /**
   * What sets its weight: a number, its handle's {@link Handle.weight | `weight`} now; `'signal'`
   * for a signal read per subject; or `'blend'` for a member of `mix.blend`, whose weight is its
   * share of the blend's signal.
   */
  readonly weight: number | 'signal' | 'blend';
  /** Whether a `stagger` delays it per subject. */
  readonly stagger: boolean;
  /** Whether a `target` or `subjects` limits which subjects it reaches. */
  readonly target: boolean;
  readonly score: string | undefined;
  readonly tags: readonly string[];
  /** Where it is placed by anchors or timestamps; undefined for one placed by `start` alone. */
  readonly anchor: Placement | undefined;
  /** The marks it places inside itself, voice ms into a pass, which anchors can name. */
  readonly marks: Readonly<Record<string, number>> | undefined;
}
