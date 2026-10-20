import type { HistoryOptions } from './history.js';
import type { Mix } from './mix.js';
import type { Sent } from './patch.js';
import type { Handle } from './voice.js';

/**
 * Every mix made on the page, for a debugger: shared by every copy of blits loaded, so a mix one
 * copy made is listed by another. `watched()` returns it.
 *
 * @category mix
 */
export interface Registry {
  /** The mixes still alive, in the order they were made. */
  entries(): Watched[];
  /** Hears each mix made, and each one collected, by its entry's `id`. Returns an unsubscribe. */
  on(
    fn: (change: { kind: 'add'; entry: Watched } | { kind: 'gone'; id: number }) => void,
  ): () => void;
  /**
   * The history a mix made from now on keeps when its options name none and it is on no
   * transport, so a debugger present before the page's mixes can scrub them. Undefined by default.
   */
  history: HistoryOptions | undefined;
}

/**
 * One mix as a debugger sees it. Built by the copy of blits that made the mix, so a debugger
 * reads mixes from other releases through it alike.
 *
 * @category mix
 */
export interface Watched<I = unknown, O = unknown> {
  /** Numbers mixes in the order they were made, across copies; what a `gone` change names. */
  readonly id: number;
  /** The release of the copy that made it. */
  readonly release: string;
  readonly name: string | undefined;
  readonly mix: Mix<I, O>;
  /** What history it keeps, and whether the registry's `history` gave it; undefined for none. */
  readonly history:
    | { readonly ms: number; readonly tape: boolean; readonly added: boolean }
    | undefined;
  /** What to call a subject: the mix's `labelOf`, else a guess from the subject itself. */
  label(subject: I): string;
  /**
   * Calls `fn` with each frame the host read, once the next one begins. While anyone watches, the
   * mix records what `probe`, `pull` and `drain` give the host, and nothing else changes. Returns
   * a function that stops watching.
   */
  watch(fn: (frame: WatchedFrame<I, O>) => void): () => void;
  /** The subjects its voices name, and those the host has read while watched. */
  subjects(): I[];
  /** One subject's pose now, read through `project`, which moves nothing: never a probe. */
  read(subject: I): O;
  /** Takes the clock from the host: see `Hold`. Throws while another hold has it. */
  hold(): Hold;
}

/**
 * What the host read in one frame.
 *
 * @category mix
 */
export interface WatchedFrame<I, O> {
  seq: number;
  /** The mix clock the frame stood at. */
  now: number;
  /** The host's timestamp at the frame's sync. */
  timestamp: number;
  /** Each probe, in order, with a copy of the pose it returned. */
  probed: { subject: I; pose: O }[];
  /** Each pull, with copies of the columns it wrote. */
  pulled: { subjects: I[]; columns: Record<string, Float64Array> }[];
  /** What `drain` handed the host. */
  sent: Sent<I, unknown>[];
  voices: Handle<I>[];
}

/**
 * A mix's clock in a debugger's hands, and every mix's on the same transport. The host's `sync`
 * still begins each frame, but the mix moves by the frame's gap at `rate`, not by the host's
 * clock; the host's own clock calls (`seek`, `rate`, `ramp`, `rebase`) wait for `free`. Nothing
 * done through a hold is recorded on the tape, and each change wakes a host sleeping on `inert`.
 *
 * @category mix
 */
export interface Hold {
  readonly mixes: Mix<unknown, unknown>[];
  /** The mix clock. */
  readonly now: number;
  /** The earliest mix time `seek` reaches: `now` without history and a tape. */
  readonly reach: number;
  /** How fast the held mix plays on the host's frames; 0 pauses it. Starts at 0. */
  rate: number;
  /** Moves the mixes to mix time `to`, back within `reach` or ahead. */
  seek(to: number): void;
  /** Plays the mixes `ms` further on, in one frame. */
  step(ms: number): void;
  /**
   * Gives the clock back: the host's rate returns, its next sync carries on from where the hold
   * left the mix, and its clock calls made meanwhile are made, in order.
   */
  free(): void;
}
