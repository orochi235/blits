/** How many numbers each voice takes in the table. */
export const ROW = 20;

/**
 * Where each of a row's numbers sits. Offsets and `FLAGS` are a u32's bits; times are ms. A voice
 * with delays fills `CLOCK` … `LAST_PASS` and the fade columns in place of `PHASE` and `PASS`.
 */
export enum Col {
  /** The voice's runner, as the kernel indexes its runners. */
  SHADER = 0,
  /** Where the voice's packed values start in the values buffer, in f32s. */
  VALUES = 1,
  PHASE = 2,
  PASS = 3,
  WEIGHT = 4,
  /** 0 for no role, else 1 + the role's index among this frame's roles. */
  ROLE = 5,
  /** `Flag` bits. */
  FLAGS = 6,
  /** Where the voice's per-subject region starts in the per-subject buffer, in f32s. */
  SUB = 7,
  /** Its timing block's delays, reach mask and fade-in origins in `persub`; NONE for none. */
  DELAYS = 8,
  MASK = 9,
  SHOWN = 10,
  /** The voice's raw time at delay 0, less B, the start of the pass it is in. */
  CLOCK = 11,
  /** -B. */
  START = 12,
  /** Its span less B, read only under `FINITE`. */
  SPAN = 13,
  DURATION = 14,
  /** B / duration. */
  PASS_BASE = 15,
  /** Its passes less 1, read only under `FINITE`. */
  LAST_PASS = 16,
  /** `fadeInAt`'s `end`, less its timing block's anchor; read only under `FADE`. */
  FADE_END = 17,
  FADE_IN = 18,
  /** Where its fade's curve starts in values; NONE for linear. */
  EASE = 19,
}
