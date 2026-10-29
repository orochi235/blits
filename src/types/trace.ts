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
   * Whether the lines are the mix's own values everywhere in the window, not only at the points.
   * Where they are not, the points are each `grid` apart and the lines between them approximate.
   */
  readonly exact: boolean;
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
