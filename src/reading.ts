/**
 * Internal: what kind of read the mix is making right now, for patches that keep state of their own
 * outside the mix. Not exported from the package.
 */
export const reading = {
  /** False while a projection reads: a patch must not commit anything then. */
  live: true,
  /**
   * The earliest voice time a read may still ask for; a patch keeping a history may drop what is
   * older. Infinity where the mix keeps none, so only what plays now is kept.
   */
  horizon: Number.POSITIVE_INFINITY,
};
