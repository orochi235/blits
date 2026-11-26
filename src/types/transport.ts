import type { Tape } from './history.js';
import type { AnnounceOptions, Mix, MixOptions, Projection, Sought } from './mix.js';
import type { Marked } from './place.js';

/**
 * How a transport is made. It says what history the transport keeps for every mix on it.
 *
 * @category mix
 */
export interface TransportOptions {
  history?: MixOptions['history'];
  /**
   * How a seek ahead moves the clock. `'play'` plays the mixes there under the rate, running out
   * any ramp on the way, as a sync to there would; `'jump'` moves there at once, the rate and any
   * ramp standing as they were, for a transport kept as a clock. Recorded calls on the way are
   * made either way. Default `'play'`.
   */
  seek?: 'play' | 'jump';
}

/**
 * Every mix on a transport read at another mix time, with nothing live moved. `of` gives one
 * mix's reading. Valid until the transport is next synced or a mix on it cued.
 *
 * @category mix
 */
export interface TransportProjection {
  /** Mix time: the time every mix is read at, not a host timestamp. */
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
  /** As `Mix.ramping`. */
  readonly ramping: { readonly to: number; readonly left: number } | null;
  /**
   * As `Mix.seek`, for every mix on it at once. Back, each mix restores itself; forward, the one
   * tape plays every mix's calls again in the order they were made, so an anchor across mixes
   * answers as it did. A mix dropped after the moment sought is back on the transport.
   */
  seek(to: number | { readonly frame: number }): void;
  /**
   * Loads from the history {@link HistoryOptions.store | `store`} what a seek or projection to `time` will need. That is, what
   * `seek(time)` and `project(time)` need where it reaches past memory. Without a store, or within
   * memory, it loads nothing. What it loads is kept until a seek or read takes it, or until
   * `history.ms` of mix time passes, after which the time needs `prepare` again.
   */
  prepare(time: number): Promise<void>;
  /**
   * As `Mix.time`: the mix time the clock will read at host `timestamp`, by the rate and any ramp
   * in force at the last sync. Every mix on it reads the same.
   */
  time(timestamp: number): number;
  /**
   * As `Mix.when`: the host timestamp at which the clock reads mix time `time`, and Infinity where
   * it stops short of it. Meant for times at or after `now`.
   */
  when(time: number): number;
  /** The mix time at the last sync or seek; NaN before the first. */
  readonly now: number;
  /**
   * As `Mix.horizon`, for every mix on it. With no history and no mix on it, it seeks anywhere, so
   * -Infinity once synced.
   */
  readonly horizon: number;
  /** Host time: the host's timestamp at the last sync; NaN before the first. */
  readonly timestamp: number;
  /** As `Mix.seq`, the number of the frame being played. It is the same for every mix on it. */
  readonly seq: number;
  readonly tape: Tape | undefined;
  /** The history every mix on it keeps, as it was made with; undefined for none. */
  readonly history: TransportOptions['history'];
  /** Puts a named mark on a score every mix on it sees. Throws without a {@link AnnounceOptions.score | `score`}. */
  announce(name: string, opts: AnnounceOptions & { score: string }): void;
  /**
   * Every mark of every mix on it now, and every mark announced on it, earliest first. A dropped
   * mix's marks are left out, even between times before its drop; `project` reads one back.
   */
  marks(from: number, to: number): Marked[];
  /**
   * Every mix on it read together at another time. The time is mix time `at`, or the frame
   * `{ frame }` names, and reading them together lets anchors across them answer. With history, a
   * read back before a drop reads the dropped mix too, as a seek there puts it back.
   */
  project(at: number | { readonly frame: number }): TransportProjection;
  /** Any mix on it live. */
  readonly live: boolean;
  /**
   * Every mix on it inert. With no mix on it, its own clock is: rate 0, no ramp under way, and no
   * rate, ramp or seek since the last sync.
   */
  readonly inert: boolean;
  /**
   * Calls `fn` when any mix on it needs frames again after a sync. It fires once until the next
   * sync.
   */
  onWake(fn: () => void): () => void;
  /** As `Mix.onSeek`, for a seek of the transport or any mix on it. */
  onSeek(fn: (sought: Sought) => void): () => void;
  /**
   * Takes a mix off the transport. It is no longer synced and takes no more calls, and reads as it
   * stood at the drop: its clock stays at the transport's mix time then. With history, a
   * seek back before the drop puts it back as it was then, and `project` reads it there; without,
   * it is let go. `marks` lists only the mixes on it now.
   */
  drop<I, O, H>(mix: Mix<I, O, H>): void;
}
