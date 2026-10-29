/**
 * One of the five times a voice is known by on the mix clock. They are when its fade in begins
 * (`start`), when it is fully in (`in`), when its last pass ends (`coast`), when its fade out
 * begins (`out`), and when it is gone (`end`). A voice coasts when `played` resolves true, for its
 * latest-staggered subject: at its `out` where it does not freeze, and where it starts showing its
 * last frame where it does. A voice that loops for good, or fades before its last pass ends, never
 * coasts.
 *
 * @category score
 */
export type Mark = 'start' | 'in' | 'coast' | 'out' | 'end';

/**
 * A mark by name. It is one of a voice's own five, or one it places inside itself with `marks`.
 *
 * @category score
 */
export type MarkName = Mark | (string & {});

/**
 * Selects voices by what the plan knows of them, never by a channel's value. It looks within the
 * asking voice's own score unless it names another. Where several match, the resolver picks one:
 * `last` cued (the default), `first` cued, `next` (the earliest whose mark is still to come),
 * `earliest` or `latest` by the mark's time.
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
 * A time given by another voice. It is `mark` of the voice `of` selects, moved by `by` ms, where
 * `mark` is one of its five or one it places inside itself with `marks`. `after` is
 * sugar for that voice's `end`, `with` for its `start`, and `before` for its start less `by`. A
 * string selects by name. `all` is the latest of its anchors, known once every one is; `any` the
 * earliest, known once one has passed or every one is known.
 *
 * @category score
 */
export type Anchor =
  | { of: string | Query; mark: MarkName; by?: number }
  | { after: string | Query; by?: number }
  | { with: string | Query; by?: number }
  | { before: string | Query; by?: number }
  | { all: readonly Anchor[] }
  | { any: readonly Anchor[] };

/**
 * Where a voice sits on the mix clock. It sets at most one of `start` and `in`, and at most one of
 * `out` and `end`, each a timestamp on the host's clock or an anchor to another voice. A voice
 * whose anchor has no answer yet waits pending; one whose anchored mark is already past starts
 * partway through, as playback does from the middle of a region. A fade out begins no earlier than
 * the voice starts: an `end` that leaves less room than `fade.out` shortens the fade to fit, and
 * one before the start makes the voice an instant, which starts and ends at its start and shows
 * nothing.
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
 * One mark as `marks` lists it. It is one of a voice's, or one the host announced on a score,
 * which has a name and no voice.
 *
 * @category score
 */
export interface Marked {
  /** On the host's clock. */
  timestamp: number;
  /**
   * Which of a voice's marks this is. It is one of its five or one it placed inside itself;
   * undefined for an announced mark.
   */
  mark: MarkName | undefined;
  /** The voice it belongs to; undefined for an announced mark. */
  voice: number | undefined;
  score: string | undefined;
  name: string | undefined;
  tags: readonly string[];
  /** The `name` of the mix the voice is in, or that announced the mark. Undefined for none. */
  mix: string | undefined;
}

/**
 * An event at a time on a voice's own clock. `book` hands it to a host ahead of time. It plays once
 * per pass, for the voice and not per subject, so `stagger` does not spread it.
 *
 * @category score
 */
export interface Hit<E = unknown> {
  /**
   * Voice ms into each pass. It runs from 0 up to the patch's `duration`, or any time from 0 for a
   * patch with none.
   */
  at: number;
  event: E;
}

/**
 * One pass of one hit, as `book` takes it.
 *
 * @category score
 */
export interface BookedHit<E = unknown, I = unknown> {
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
  /** The subjects its voice names with `subjects`; undefined for a voice that names none. */
  subjects: readonly I[] | undefined;
}

/**
 * What `book` takes. It names an outside clock, how far ahead to book on it, and what to do with
 * each item.
 *
 * @category score
 */
export interface BookOptions<E = unknown, I = unknown> {
  /**
   * The outside clock, in ms. It is `audio.currentTime * 1000`, `performance.now()`, or whatever
   * the host schedules against. Read once a sync. The mix maps its host time onto it by an offset
   * that folds in 5% of each frame's difference, and starts over from the clock's own reading on a
   * jump past 50 ms, such as a suspended context or a hidden tab.
   */
  clock: () => number;
  /** How far ahead to book, host ms. It has to cover the longest gap between two syncs. */
  ahead: number;
  /** How late an item may be when first seen and still be taken, host ms. */
  late: number;
  /**
   * Called once per item, a mark as `marks` lists it or a hit. `when` is on the outside clock;
   * `lateBy` is how many host ms past the item was when first seen, which is then taken at the
   * clock's now; it is 0 for one booked ahead. Return a `cancel` to hear about a booking whose time moved by
   * more than 1 ms or that went away (a seek, a rate or ramp on the voice or the mix, a fade, a
   * `rebase`, an anchor's target moving, the voice leaving); the item is then booked again, at its
   * new time, at the same sync.
   */
  take(item: Marked | BookedHit<E, I>, when: number, lateBy: number): Taken | undefined;
  /** Book only the voices, and announced marks, carrying this tag. */
  tag?: string;
  /** Book only this score's voices and marks. */
  score?: string;
}

/**
 * What `BookOptions.take` may return for a booking it took.
 *
 * @category score
 */
export interface Taken {
  /** Called when the booking's time moved by more than 1 ms, or it went away. */
  cancel(): void;
}

/**
 * A running booker, returned by `book`.
 *
 * @category score
 */
export interface Booker {
  /** Cancels every booking still ahead, and books nothing more. */
  cancel(): void;
  /**
   * Where host `timestamp` falls on the outside clock. It goes by the offset as the last sync left
   * it; NaN before the first sync.
   */
  at(timestamp: number): number;
}
