/** A voice's timing bits in its table row. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row` in src/lane.ts
export const enum Flag {
  SHOWS = 1,
  BEGINLESS = 2,
  HOLDS_FIRST = 4,
  FREEZES_AFTER = 8,
  HIDES_PAST = 16,
  UNSTARTED = 32,
  FINITE = 64,
  /** Its raw time is NaN: `frozenTime`'s pending voice at rate 0. */
  NO_CLOCK = 128,
  FADE = 256,
}

/** The absent-offset sentinel, as a u32. */
export const NONE = 0xffffffff;

/**
 * `blits_clock(raw, flags, start, span, duration, pass_base, last_pass)`: a subject's clock as
 * `Voice.before`, `Voice.shownAt` and `phaseOf`/`passAt` in `src/contribution.ts` read it, with
 * every time less B, the start of the voice's pass: `start` is -B, `span` is span - B (read only
 * under `FINITE`), `pass_base` is B / duration, `last_pass` is passes - 1. Needs nothing in scope.
 */
export const CLOCK_WGSL = /* wgsl */ `
struct Clock { shows: bool, elapsed: f32, phase: f32, pass_index: f32 }

fn blits_clock(raw: f32, flags: u32, start: f32, span: f32, duration: f32, pass_base: f32, last_pass: f32) -> Clock {
  let hidden = Clock(false, 0.0, 0.0, 0.0);
  let beginless = (flags & ${Flag.BEGINLESS}u) != 0u;
  let holds = (flags & ${Flag.HOLDS_FIRST}u) != 0u;
  let finite = (flags & ${Flag.FINITE}u) != 0u;
  let no_clock = (flags & ${Flag.NO_CLOCK}u) != 0u;
  let early = ((no_clock || raw < start) && !beginless) || (flags & ${Flag.UNSTARTED}u) != 0u;
  if (early && !holds) { return hidden; }
  if (no_clock && beginless) { return hidden; }
  var e = raw;
  var at_start = false;
  if (!beginless) {
    if (no_clock || raw < start) {
      e = start;
      at_start = true;
    } else if (finite && raw > span) {
      if ((flags & ${Flag.HIDES_PAST}u) != 0u) { return hidden; }
      if ((flags & ${Flag.FREEZES_AFTER}u) != 0u) { e = span; }
    }
  }
  if (!(duration > 0.0)) { return Clock(true, e, 0.0, 0.0); }
  if (finite && e >= span) { return Clock(true, e, 1.0, last_pass); }
  // Voice time 0 exactly, which e - start in f32 can't promise once B is large.
  if (at_start) { return Clock(true, e, 0.0, 0.0); }
  var q = floor(e / duration);
  var r = e - q * duration;
  if (r < 0.0) { r += duration; q -= 1.0; }
  if (r >= duration) { r -= duration; q += 1.0; }
  return Clock(true, e, r / duration, pass_base + q);
}
`;

/**
 * `blits_fade_in(end, shown, fade_in, ease_at)`: `fadeInAt` with no stalls and no stop, `end` and
 * `shown` less the same anchor; `ease_at` is the curve's offset in `values`, `NONE` for linear.
 * Needs `EASING_WGSL`, and so `values`, in scope.
 */
export const FADE_WGSL = /* wgsl */ `
fn blits_fade_in(end: f32, shown: f32, fade_in: f32, ease_at: u32) -> f32 {
  if (!(fade_in > 0.0)) { return 1.0; }
  let u = (end - shown) / fade_in;
  if (u >= 1.0) { return 1.0; }
  let c = max(0.0, u);
  if (ease_at == ${NONE}u) { return c; }
  return blits_ease(ease_at, c);
}
`;
