/**
 * The times a voice is known by on the mix clock: when its fade in begins (`start`), when it is
 * fully in (`in`), when its last pass ends (`coast`), when its fade out begins (`out`), and when it
 * is gone (`end`). A voice coasts when `played` resolves true, for its latest-staggered subject: at
 * its `out` where it does not freeze, and where it starts showing its last frame where it does. A
 * voice that loops for good, or fades before its last pass ends, never coasts.
 *
 * @category score
 */
export type Mark = 'start' | 'in' | 'coast' | 'out' | 'end';

/**
 * Selects voices by what the plan knows of them, never by a channel's value, within the asking
 * voice's own score unless it names another. Where several match,
 * the resolver picks one: `last` cued (the default), `first` cued, `next` (the earliest whose mark
 * is still to come), `earliest` or `latest` by the mark's time.
 *
 * @category score
 */
export interface Query {
  /** The score to look in. Default: the asking voice's own. */
  score?: string;
  name?: string;
  tag?: string;
  /** A channel the voice's patch writes. */
  writes?: string;
  resolver?: 'last' | 'first' | 'next' | 'earliest' | 'latest';
}

/**
 * A time given by another voice: `mark` of the voice `of` selects, moved by `by` ms. `after` is
 * sugar for that voice's `end`, `with` for its `start`, and `before` for its start less `by`. A
 * string selects by name. `all` is the latest of its anchors, known once every one is; `any` the
 * earliest, known once one has passed or every one is known.
 *
 * @category score
 */
export type Anchor =
  | { of: string | Query; mark: Mark; by?: number }
  | { after: string | Query; by?: number }
  | { with: string | Query; by?: number }
  | { before: string | Query; by?: number }
  | { all: readonly Anchor[] }
  | { any: readonly Anchor[] };

/**
 * Where a voice sits on the mix clock: at most one of `start` and `in`, and at most one of `out`
 * and `end`, each a timestamp on the host's clock or an anchor to another voice. A voice whose
 * anchor has no answer yet waits pending; one whose anchored mark is already past starts partway
 * through, as playback does from the middle of a region.
 *
 * @category score
 */
export interface Placement {
  start?: number | Anchor;
  in?: number | Anchor;
  out?: number | Anchor;
  end?: number | Anchor;
}

/**
 * One mark as `marks` lists it: one of a voice's, or one the host announced on a score, which has a
 * name and no voice.
 *
 * @category score
 */
export interface Marked {
  /** On the host's clock. */
  timestamp: number;
  /** Which of a voice's this is; undefined for an announced mark. */
  mark: Mark | undefined;
  /** The voice it belongs to; undefined for an announced mark. */
  voice: number | undefined;
  score: string | undefined;
  name: string | undefined;
  tags: readonly string[];
  /** The `name` of the mix the voice is in, or that announced the mark; undefined for none. */
  mix: string | undefined;
}

/**
 * An event at a time on a voice's own clock, which `book` hands a host ahead of time. It plays once
 * per pass, for the voice and not per subject, so `stagger` does not spread it.
 *
 * @category score
 */
export interface Hit<E = unknown> {
  /** Voice ms into each pass: 0 up to the patch's `duration`, or any time at all for a patch with none. */
  at: number;
  event: E;
}

/**
 * One pass of one hit, as `book` takes it.
 *
 * @category score
 */
export interface BookedHit<E = unknown> {
  /** On the host's clock. */
  timestamp: number;
  voice: number;
  /** Which of the voice's `hits`, by index. */
  hit: number;
  /** Which pass, 0 first. */
  pass: number;
  event: E;
  score: string | undefined;
  name: string | undefined;
  tags: readonly string[];
}

/**
 * What `book` takes: an outside clock, how far ahead to book on it, and what to do with each item.
 *
 * @category score
 */
export interface BookOptions<E = unknown> {
  /**
   * The outside clock, in ms: `audio.currentTime * 1000`, `performance.now()`, or whatever the host
   * schedules against. Read once a sync. The mix maps its host time onto it by an offset that folds
   * in 5% of each frame's difference, and starts over from the clock's own reading on a jump past
   * 50 ms, such as a suspended context or a hidden tab.
   */
  clock: () => number;
  /** How far ahead to book, host ms. It has to cover the longest gap between two syncs. */
  ahead: number;
  /** How far past an item first seen late may be and still be taken, host ms. */
  late: number;
  /**
   * Called once per item: a mark as `marks` lists it, or a hit. `when` is on the outside clock;
   * `lateBy` is how many host ms past the item was when first seen, 0 for one booked ahead, which
   * is then taken at the clock's now. Return a `stop` to hear about a booking whose time moved by
   * more than 1 ms or that went away (a seek, a rate or ramp on the voice or the mix, a fade, a
   * `rebase`, an anchor's target moving, the voice leaving); the item is then booked again, at its
   * new time, at the same sync.
   */
  take(item: Marked | BookedHit<E>, when: number, lateBy: number): { stop(): void } | undefined;
  /** Book only the voices, and announced marks, carrying this tag. */
  tag?: string;
  /** Book only this score's voices and marks. */
  score?: string;
}

/**
 * A running booker, returned by `book`.
 *
 * @category score
 */
export interface Booker {
  /** Stops every booking still ahead, and books nothing more. */
  stop(): void;
}

/**
 * What `cue` takes: a patch, and the clock, weight and reach it plays with.
 *
 * @category voice
 */
