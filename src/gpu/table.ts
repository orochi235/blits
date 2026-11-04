import { passAt, phaseAt, phaseBefore, weighed } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';

/** How many numbers each voice takes in the table. */
export const ROW = 8;

/** Where each of a row's numbers sits. */
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
  /** 1 where the voice is its role's first member this frame. */
  FIRST = 6,
  /** Where the voice's per-subject region starts in the per-subject buffer, in f32s. */
  SUB = 7,
}

/** Where a voice's runner and data sit, as the table records them. */
export interface Slot {
  readonly runner: number;
  readonly values: number;
  readonly sub: number;
}

/** The frame's voices as the kernel reads them. */
export interface Table {
  readonly rows: Float32Array;
  readonly count: number;
  /** How many roles this frame's voices play. */
  readonly roles: number;
}

/**
 * A voice's time at mix time `now`, as the general path's `contribution` gives a subject with no
 * stagger; NaN where it shows nothing then.
 */
export function elapsedOf<I, O>(voice: Voice<I, O>, now: number): number {
  const raw = voice.rawAt(now, 0);
  return voice.before(raw, now) && !voice.holdsFirst ? Number.NaN : voice.shownAt(raw);
}

/**
 * Each voice's numbers for this frame, worked out once for every subject: a voice the GPU runs
 * plays the same for all of them. The time, phase, and weight come out as the general path's
 * `contribution` and `weigh` give them.
 */
export function voiceTable<I, O>(
  mix: Mixer<I, O>,
  voices: readonly Voice<I, O>[],
  /** Each voice's runner and data, in `voices` order. */
  slots: readonly Slot[],
): Table {
  const now = mix.now;
  const rows = new Float32Array(Math.max(1, voices.length) * ROW);
  const roles = new Map<string, number>();
  voices.forEach((voice, k) => {
    const slot = slots[k];
    if (slot === undefined) throw new Error('blits: a voice in the GPU table has no slot');
    const o = k * ROW;
    rows[o + Col.SHADER] = slot.runner;
    rows[o + Col.VALUES] = slot.values;
    rows[o + Col.SUB] = slot.sub;
    const elapsed = elapsedOf(voice, now);
    if (Number.isNaN(elapsed)) return;
    // A member showing nothing this frame does not meet its role, so the next one leads it.
    const role = voice.spec.role;
    if (role !== undefined) {
      const known = roles.get(role);
      rows[o + Col.ROLE] = (known ?? roles.size) + 1;
      if (known === undefined) {
        roles.set(role, roles.size);
        rows[o + Col.FIRST] = 1;
      }
    }
    const since = mix.sinceOf(voice, 0);
    const fade = mix.envelope(voice, now, mix.shownOf(voice, since));
    rows[o + Col.PHASE] =
      elapsed < 0
        ? phaseBefore(elapsed, voice.duration)
        : phaseAt(elapsed, voice.duration, voice.passes);
    rows[o + Col.PASS] = passAt(elapsed, voice.duration, voice.passes);
    rows[o + Col.WEIGHT] = weighed(voice.weight, fade, 1);
  });
  return { rows, count: voices.length, roles: roles.size };
}
