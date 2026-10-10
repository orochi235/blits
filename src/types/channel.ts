/**
 * One field of a delta, with its own arithmetic.
 *
 * @category channel
 */
export interface Channel<V> {
  /**
   * Names this channel's arithmetic, so a patch written against one channel can be checked against
   * another of the same name. Two channels of one kind must fold identically; the stock ones set it,
   * as `'sum'` or `'vec(3, sum)'`. Absent, a channel matches only itself.
   */
  kind?: string;
  /**
   * The range a numeric value means anything in, such as 0..1 for an opacity. The mix clamps the
   * folded value to it, axis by axis for an array, so neither stacked voices nor a retarget that
   * carries speed can push it out; overshoot stops flat at the bound.
   */
  bounds?: readonly [min: number, max: number];
  /** Identity. Absent means the channel has none: it replaces rather than contributes. */
  rest?: V;
  /** Fold two contributions into one. */
  merge(a: V, b: V): V;
  /** Fade toward `rest` by weight 0..1. Required when `rest` is set; absent otherwise. */
  scale?(v: V, w: number): V;
  /** Interpolate, for retargeting, for blending alternatives, and for folding a locus. */
  lerp(a: V, b: V, u: number): V;
  /**
   * Optional: `merge(into, scale(v, w))`, written into `into` and returned, so a channel whose
   * values are objects need not allocate per contribution. The mix only hands it a value it made.
   */
  fold?(into: V, v: V, w: number): V;
  /**
   * Optional: a fresh copy of `v`, which the mix makes of `rest` for `fold` to write into. The mix
   * copies arrays, typed arrays and plain objects itself; a channel whose `rest` is anything else,
   * such as a class instance, and that has `fold`, needs this or `cue` refuses it.
   */
  copy?(v: V): V;
}

/**
 * The channel set for one kind of delta.
 *
 * @category channel
 */
export type Kit<O> = { readonly [K in keyof O]-?: Channel<NonNullable<O[K]>> };
