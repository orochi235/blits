import type { Tape } from './history.js';
import type { AnnounceOptions, Mix, MixOptions, Projection } from './mix.js';
import type { Marked } from './place.js';

/**
 * How a transport is made. It says what history the transport keeps for every mix on it.
 *
 * @category mix
 */
export interface TransportOptions {
  history?: MixOptions['history'];
}

/**
 * Every mix on a transport read at another mix time, with nothing live moved. `of` gives one
 * mix's reading. Valid until the transport is next synced or a mix on it cued.
 *
 * @category mix
 */
export interface TransportProjection {
  readonly timestamp: number;
  of<I, O, H>(mix: Mix<I, O, H>): Projection<I, O>;
}

/**
 * One clock several mixes play on, each over its own kit. It gives them one sync, one rate, one
 * seek and one tape, and a score that spans them, so an anchor in one mix waits on a voice in
 * another by naming the score they share. A query naming no score stays in its own mix.
 *
 * @category mix
 */
export interface Transport {
  /** The host reports the clock once a frame, after the frame's cues, as `Mix.sync` does. */
  sync(timestamp: number): void;
  /** As `Mix.rebase`, for every mix on it. */
  rebase(): void;
  /** As `Mix.rate`, multiplied into every voice of every mix on it. */
  rate: number;
  ramp(rate: number, over: number): void;
  /**
   * As `Mix.seek`, for every mix on it at once. Back, each mix restores itself; forward, the one
   * tape plays every mix's calls again in the order they were made, so an anchor across mixes
   * answers as it did. A mix dropped after the moment sought is back on the transport.
   */
  seek(to: number | { readonly frame: number }): void;
  /**
   * Loads from the history `store` what a seek or projection to `time` will need. That is, what
   * `seek(time)` and `project(time)` need where it reaches past memory. Without a store, or within
   * memory, it loads nothing. What it loads is kept until a seek or read takes it, or until
   * `history.ms` of mix time passes, after which the time needs `prepare` again.
   */
  prepare(time: number): Promise<void>;
  readonly now: number;
  /** As `Mix.seq`, the number of the frame being played. It is the same for every mix on it. */
  readonly seq: number;
  readonly tape: Tape | undefined;
  /** Puts a named mark on a score every mix on it sees. Throws without a `score`. */
  announce(name: string, opts: AnnounceOptions & { score: string }): void;
  /** Every mark of every mix on it, and every mark announced on it, earliest first. */
  marks(from: number, to: number): Marked[];
  /**
   * Every mix on it read together at another time. The time is mix time `at`, or the frame
   * `{ frame }` names, and reading them together lets anchors across them answer.
   */
  project(at: number | { readonly frame: number }): TransportProjection;
  /** Any mix on it live. */
  readonly live: boolean;
  /** Every mix on it inert. */
  readonly inert: boolean;
  /**
   * Calls `fn` when any mix on it needs frames again after a sync. It fires once until the next
   * sync.
   */
  onWake(fn: () => void): () => void;
  /**
   * Takes a mix off the transport. It is no longer synced and takes no more calls. With history, a
   * seek back before the drop puts it back as it was then; without, it is let go.
   */
  drop<I, O, H>(mix: Mix<I, O, H>): void;
}
