import { clampWeight, envelope } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { Col, passBits } from './columns.js';
import type { Slot } from './table.js';
import type { Weighs } from './weight.js';
import { Flag, NONE } from './wgsl/timing.js';

/**
 * Fills a staggered voice's clock, fade and timing flags into its row at `o`. Its raw time at
 * delay 0 and its span go in less B, the start of the pass that time is in, so f32 keeps whole ms
 * however long it has played; the kernel takes each subject's delay off and runs `blits_clock`.
 */
export function rowClock<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  slot: Slot,
  weigh: Weighs,
  rows: Float32Array,
  bits: Uint32Array,
  o: number,
): void {
  const timing = slot.timing;
  if (timing === undefined || timing.delays === NONE)
    throw new Error('blits: a row clock for a voice with no delays');
  const now = mix.now;
  const { duration, passes, span } = voice;
  const finite = Number.isFinite(span);
  const raw = voice.rawAt(now, 0);
  let first = 0;
  if (Number.isFinite(raw) && duration > 0) {
    // A beginless voice runs on below 0 for good, so its B follows it there.
    const q = Math.floor(raw / duration);
    const pass = voice.beginless ? q : Math.max(0, q);
    first = Number.isFinite(passes) ? Math.min(pass, passes - 1) : pass;
  }
  const base = duration * first;
  let flags =
    (voice.beginless ? Flag.BEGINLESS : 0) |
    (voice.holdsFirst ? Flag.HOLDS_FIRST : 0) |
    (voice.freezesAfter ? Flag.FREEZES_AFTER : 0) |
    (voice.hidesPast ? Flag.HIDES_PAST : 0) |
    (voice.unstarted(now) ? Flag.UNSTARTED : 0) |
    (finite ? Flag.FINITE : 0);
  if (Number.isNaN(raw)) flags |= Flag.NO_CLOCK;
  rows[o + Col.CLOCK] = Number.isNaN(raw) ? 0 : raw - base;
  rows[o + Col.START] = -base;
  rows[o + Col.SPAN] = finite ? span - base : 0;
  rows[o + Col.DURATION] = duration;
  bits[o + Col.PASS_BASE] = passBits(first);
  bits[o + Col.LAST_PASS] = passBits(finite ? passes - 1 : 0);

  const fadeIn = voice.fade.in ?? 0;
  const out = voice.out;
  const reduced = mix.reducedNow;
  const end = out !== null && !out.rest && out.at < now ? out.at : now;
  // A block with no origins has `latest` -Infinity, which leaves FADE off.
  const fading = fadeIn > 0 && !reduced && end - timing.latest < fadeIn;
  // The envelope with the fade in taken as done: under FADE the kernel multiplies each subject's,
  // and where it reads a per-subject weight, that too, clamping after both.
  const w =
    weigh.base *
    (envelope(0, out, voice.ease, reduced, now, 0, voice.back, voice.stalls) * weigh.owned);
  rows[o + Col.FADE_IN] = fadeIn;
  if (fading) {
    flags |= Flag.FADE;
    rows[o + Col.FADE_END] = end - timing.anchor;
  }
  rows[o + Col.WEIGHT] = fading || slot.weights !== undefined ? w : clampWeight(w);
  bits[o + Col.FLAGS] = flags;
}
