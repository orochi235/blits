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
  /**
   * Whether it runs on a lane, a crowd's row counting as one, and why not where it does not, as the
   * lanes last decided it: at the latest probe or `pull`, not at `describe`. A voice cued, or
   * changed in a way that moves it on or off, since that probe shows as it was then, or `'new'`.
   */
  readonly lane: OutlineLane;
}

/**
 * Whether a voice runs on a lane, as {@link OutlineVoice.lane} reports it.
 *
 * @category mix
 */
export type OutlineLane = { readonly on: true } | { readonly on: false; readonly why: OffLane };

/**
 * Why a voice runs off lanes, on the general path. Each names the first rule the lanes found it
 * breaking:
 *
 * - `'mix'`: the mix runs no lanes, under `lanes: false` or from `@msb235/blits/lean`.
 * - `'new'`: no probe or `pull` has met it since it was cued, so the lanes have not decided.
 * - `'none'`: it writes no channel, as an owner, span or arc does.
 * - `'state'`: its patch keeps state, declared or through `setting.keep`, or its weight signal
 *   does.
 * - `'input'`: its weight is an input signal whose changes the lanes cannot hear: flagged `input`
 *   by hand rather than made by `input()`, or any input under history's `inputs`.
 * - `'reads'`: its patch `reads` host fields.
 * - `'owner'`: an owner above it weighs by a signal.
 * - `'wait'`: it waits to start under `freeze: 'before'`, or is fading before it started.
 * - `'back'`: it runs backward with no end, or fades out from where it ran back to its start.
 * - `'from'`: it is cued `from: 'current'`.
 * - `'rest'`: it fades out to rest, `fade({ at: 'rest' })`.
 * - `'axes'`: it weighs a vec's axes apart, by `axes`.
 * - `'lerp'`: a `keys` patch whose `lerpBy` is not the channel's own lerp.
 * - `'last'`: it writes a `last` channel while playing a motion, in a role (a blend's members
 *   among them), or naming one subject.
 * - `'role'`: another member of its role is off, which takes every member with it.
 * - `'calls'`: an `fn` voice writing only vecs, where no voice but its like writes them, which
 *   runs faster off lanes than on, where a fill walks its subjects a second time.
 * - `'kind'`: it writes a channel no lane folds, such as a custom one.
 * - `'shared'`: it writes a channel that a voice off lanes also writes, which closes the channel.
 *
 * @category mix
 */
export type OffLane =
  | 'mix'
  | 'new'
  | 'none'
  | 'state'
  | 'input'
  | 'reads'
  | 'owner'
  | 'wait'
  | 'back'
  | 'from'
  | 'rest'
  | 'axes'
  | 'lerp'
  | 'last'
  | 'role'
  | 'calls'
  | 'kind'
  | 'shared';
