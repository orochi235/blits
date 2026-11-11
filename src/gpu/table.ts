import { passAt, phaseAt, phaseBefore, weighed } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { Col, passBits, ROW } from './columns.js';
import { rowClock } from './row-clock.js';
import type { TimingSlot } from './timings.js';
import type { Weighs } from './weight.js';
import { Flag, NONE } from './wgsl/timing.js';

export { Col, ROW } from './columns.js';

/** Where a voice's runner and data sit, as the table records them. */
export interface Slot {
  readonly runner: number;
  readonly values: number;
  readonly sub: number;
  /** Its timing block, for a voice that staggers or leaves some registered subject unreached. */
  readonly timing?: TimingSlot;
  /** Its fade curve's offset in values; absent for linear. */
  readonly ease?: number;
  /** Where its per-subject weight reads start in `persub`; absent where it has none. */
  readonly weights?: number;
}

/** The frame's voices as the kernel reads them. */
export interface Table {
  readonly rows: Float32Array;
  readonly count: number;
  /** How many roles this frame's voices play. */
  readonly roles: number;
}

/**
 * A voice's time at mix time `now` for a subject `delay` ms behind, as the general path's
 * `contribution` gives it; NaN where it shows nothing then.
 */
export function elapsedOf<I, O>(voice: Voice<I, O>, now: number, delay = 0): number {
  const raw = voice.rawAt(now, delay);
  return voice.shownTime(raw, voice.before(raw, now));
}

/**
 * Each voice's numbers for this frame. A voice with no delays plays the same for every subject, so
 * its time, phase, and weight are worked out once, as the general path's `contribution` and `weigh`
 * give them; one with delays carries its clock for the kernel to work out each subject's.
 */
export function voiceTable<I, O>(
  mix: Mixer<I, O>,
  voices: readonly Voice<I, O>[],
  /** Each voice's runner and data, in `voices` order. */
  slots: readonly Slot[],
  /** Each voice's weight reads, in `voices` order, as `weighsOf` gives them once per fold. */
  weighs: readonly Weighs[],
): Table {
  const now = mix.now;
  const rows = new Float32Array(Math.max(1, voices.length) * ROW);
  // Offsets go in as u32 bits: an f32 rounds them past 2^24.
  const bits = new Uint32Array(rows.buffer);
  const roles = new Map<string, number>();
  voices.forEach((voice, k) => {
    const slot = slots[k];
    if (slot === undefined) throw new Error('blits: a voice in the GPU table has no slot');
    const o = k * ROW;
    const timing = slot.timing;
    rows[o + Col.SHADER] = slot.runner;
    bits[o + Col.VALUES] = slot.values;
    bits[o + Col.SUB] = slot.sub;
    bits[o + Col.DELAYS] = timing?.delays ?? NONE;
    bits[o + Col.MASK] = timing?.mask ?? NONE;
    bits[o + Col.SHOWN] = timing?.shown ?? NONE;
    bits[o + Col.CODES] = timing?.codes ?? NONE;
    bits[o + Col.EASE] = slot.ease ?? NONE;
    bits[o + Col.WEIGHTS] = slot.weights ?? NONE;
    const weigh = weighs[k] as Weighs;
    const role = voice.spec.role;
    if (role !== undefined) {
      let r = roles.get(role);
      if (r === undefined) {
        r = roles.size;
        roles.set(role, r);
      }
      rows[o + Col.ROLE] = r + 1;
    }
    if (timing !== undefined && timing.delays !== NONE) {
      rowClock(mix, voice, slot, weigh, rows, bits, o);
      return;
    }
    const elapsed = elapsedOf(voice, now);
    if (Number.isNaN(elapsed)) return;
    bits[o + Col.FLAGS] = Flag.SHOWS;
    rows[o + Col.PHASE] =
      elapsed < 0
        ? phaseBefore(elapsed, voice.duration)
        : phaseAt(elapsed, voice.duration, voice.passes);
    bits[o + Col.PASS] = passBits(passAt(elapsed, voice.duration, voice.passes));
    // Where the kernel multiplies each subject's read in, it clamps after.
    const owned = weigh.faded;
    rows[o + Col.WEIGHT] =
      slot.weights === undefined ? weighed(weigh.base, owned, 1) : weigh.base * owned;
  });
  return { rows, count: voices.length, roles: roles.size };
}
