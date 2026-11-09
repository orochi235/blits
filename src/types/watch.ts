import type { HistoryOptions } from './history.js';
import type { Mix } from './mix.js';
import type { Sent } from './patch.js';
import type { Circle, Finder, Handle } from './voice.js';

/**
 * Every mix made on the page, for a debugger. It is shared by every copy of blits loaded, so a
 * mix one copy made is listed by another. `watched()` returns it.
 *
 * @category mix
 */
export interface Registry {
  /** The mixes still alive, in the order they were made. */
  entries(): Watched[];
  /** Hears each mix made, and each one collected, by its entry's {@link Watched.id | `id`}. Returns an unsubscribe. */
  on(fn: (change: RegistryChange) => void): () => void;
  /**
   * The history new mixes keep when they name none. It applies to a mix made from now on whose
   * options name no history and that is on no transport, so a debugger present before the page's
   * mixes can scrub them. Undefined by default.
   */
  history: HistoryOptions | undefined;
}

/**
 * What `Registry.on` hears. It is a mix made, with its entry, or a mix collected, by its entry's
 * {@link Watched.id | `id`}.
 *
 * @category mix
 */
export type RegistryChange = { kind: 'add'; entry: Watched } | { kind: 'gone'; id: number };

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
  readonly history: WatchedHistory | undefined;
  /** The earliest mix time `read` reaches back to. It is `mix.now` without history. */
  readonly reach: number;
  /** The kit's channel names, in kit order. */
  readonly channels: readonly string[];
  /** Each channel's `kind`, in kit order, undefined for a channel with none. */
  readonly kinds: readonly (string | undefined)[];
  /**
   * What a voice was cued with that its handle does not carry. Undefined for a handle not on this
   * mix.
   */
  voice(handle: Handle<I>): WatchedVoice | undefined;
  /** What to call a subject. It is the mix's `labelOf`, else a guess from the subject itself. */
  label(subject: I): string;
  /**
   * Calls `fn` with each frame the host read, once the next one begins. While anyone watches, the
   * mix records what {@link Mix.probe | `probe`}, `pull` and `drain` give the host, and nothing else changes. Returns
   * a function that stops watching.
   */
  watch(fn: (frame: WatchedFrame<I, O>) => void): () => void;
  /**
   * The subjects its voices still playing name. It also lists those the host read in the last two
   * frames while watched.
   */
  subjects(): I[];
  /**
   * Whether the mix has met `subject`: read it through `probe` or `pull`, or holds a voice naming
   * it. Unlike {@link Watched.subjects | `subjects`}, it knows a subject the host reads without
   * the mix being watched. A copy of blits older than this one leaves it out.
   */
  knows?(subject: I): boolean;
  /**
   * One subject's pose at mix time `at`, default now. It is read through {@link Mix.project | `project`}, which moves
   * nothing, never a probe. A time behind now needs history that reaches it.
   */
  read(subject: I, at?: number): O;
  /** Takes the clock from the host. See `Hold`. Throws while another hold has it. */
  hold(): Hold;
}

/**
 * What history a watched mix keeps, as `Watched.history` reports it.
 *
 * @category mix
 */
export interface WatchedHistory {
  /** How much stays in memory, ms of mix time. */
  readonly ms: number;
  /** Whether it records a tape. */
  readonly tape: boolean;
  /** Whether the registry's {@link Registry.history | `history`} gave it. */
  readonly added: boolean;
}

/**
 * What a voice was cued with that its handle does not carry. `Watched.voice` reports it.
 *
 * @category mix
 */
export interface WatchedVoice {
  readonly name: string | undefined;
  readonly tags: readonly string[];
  readonly track: string | undefined;
  /**
   * What it is bounded to, by `within` or an `around` weight. It is a circle, read live, or the
   * host's finder; undefined for none.
   */
  readonly within: Readonly<Circle> | Finder | undefined;
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
  /** Host time: the host's timestamp at the frame's sync. */
  timestamp: number;
  /** Each probe, in order, with a copy of the pose it returned. */
  probed: Probed<I, O>[];
  /** Each pull, with copies of the columns it wrote. */
  pulled: Pulled<I>[];
  /** What `drain` handed the host. */
  sent: Sent<I, unknown>[];
  voices: Handle<I>[];
}

/**
 * One probe a watched frame recorded.
 *
 * @category mix
 */
export interface Probed<I, O> {
  subject: I;
  /** A copy of the pose the probe returned. */
  pose: O;
}

/**
 * One pull a watched frame recorded.
 *
 * @category mix
 */
export interface Pulled<I> {
  subjects: I[];
  /** Copies of the columns it wrote, by channel. */
  columns: Record<string, Float64Array>;
}

/**
 * A mix's clock in a debugger's hands, and every mix's on the same transport. The host's {@link Mix.sync | `sync`}
 * still begins each frame, but the frame's gap counts at `rate`, so the mix moves at `rate` times
 * its own rate; the host's own clock calls ({@link Mix.seek | `seek`}, {@link Mix.rate | `rate`}, {@link Mix.ramp | `ramp`}, {@link Mix.rebase | `rebase`}) wait for `free`.
 * Nothing done through a hold is recorded on the tape or in the mix's rate, and each change wakes
 * a host sleeping on {@link Mix.inert | `inert`}.
 *
 * @category mix
 */
export interface Hold {
  readonly mixes: Mix<unknown, unknown>[];
  /** The mix clock. */
  readonly now: number;
  /** The earliest mix time `seek` reaches. It is `now` without history and a tape. */
  readonly reach: number;
  /** How much of each of the host's frames the held mix plays; 0 pauses it. Starts at 0. */
  rate: number;
  /**
   * Moves the mixes to mix time `to`, back within `reach` or ahead, or to the frame `{ frame }`
   * names, as `Mix.seek` takes it.
   */
  seek(to: number | { readonly frame: number }): void;
  /** Plays the mixes `ms` of mix time further on, in one frame. */
  step(ms: number): void;
  /**
   * Gives the clock back to the host. The host's next sync carries on from where the hold left the
   * mix, and its clock calls made meanwhile are made, in order. A call made while the tape holds
   * later calls acts on the mix but is not recorded, so those calls still play.
   */
  free(): void;
}
