/** A voice's `stagger` and `target` answers kept elsewhere, which `held` takes before asking. */
export interface Asked<I> {
  /** The subject's delay; undefined where it has none kept. */
  delay(subject: I): number | undefined;
  /** Whether the voice reaches the subject; undefined where it has none kept. */
  reaches(subject: I): boolean | undefined;
}
