/**
 * What `mix.trace` takes besides its window.
 *
 * @category mix
 */
export interface TraceOptions {
  /**
   * Where a run cannot be known exactly, how far apart it is read, in ms of mix time. Default 5.
   */
  grid?: number;
  /**
   * Gives a stretch whose shape is known but not straight, such as an eased stop of a `keys` voice
   * or a tween's stretch, as its two ends and a {@link Bend}, where it would otherwise be read on
   * the grid. Default false.
   */
  bends?: boolean;
}

/**
 * How a run's stretch between two points stands off the straight line between them, for a stretch
 * whose shape is known but not straight.
 *
 * @category mix
 */
export interface Bend {
  /** The index in `at` of the point the stretch starts at; it ends at the next. */
  readonly index: number;
  /**
   * How far the value stands off the line `u` of the way along the stretch, `u` from 0 to 1 in
   * time: the value there is the line's plus this. 0 at both ends.
   */
  off(u: number): number;
}

/**
 * One channel of one subject over a trace's window, as points joined by straight lines: the value
 * between two points is the straight line between them. Two points at one time are a jump, from
 * the first value to the second. The first point is at the window's start and the last at its end.
 *
 * @category mix
 */
export interface Run {
  /** Mix times, ascending; a time given twice is a jump. */
  readonly at: readonly number[];
  /** The channel's value at each of `at`; NaN where it holds no number. */
  readonly value: readonly number[];
  /**
   * Whether the lines, with any bends, are the mix's own values everywhere in the window, not only
   * at the points. Where they are not, the points are each {@link TraceOptions.grid | `grid`} apart and the lines between them approximate.
   */
  readonly exact: boolean;
  /**
   * The stretches that bend off their line, by the index of the point each starts at, ascending;
   * present only for a trace asked for {@link TraceOptions.bends | `bends`}.
   */
  readonly bends?: readonly Bend[];
}

/**
 * The channels of `O` that hold one number.
 *
 * @category mix
 */
export type NumberChannel<O> = {
  [K in keyof O]-?: NonNullable<O[K]> extends number ? K : never;
}[keyof O];

/**
 * The mix read over a window of mix time, with nothing in the live mix moved. Valid until the mix
 * is next synced or cued.
 *
 * @category mix
 */
export interface Trace<I, O> {
  /** The window's start, in mix time. */
  readonly from: number;
  /** The window's end, in mix time. */
  readonly to: number;
  /** One subject's channel over the window. */
  of(subject: I, channel: NumberChannel<O>): Run;
}
