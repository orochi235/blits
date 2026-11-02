import { passAt, phaseAt, phaseBefore, weighed } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { gpuDescriptor, type Shader } from './shader-patch.js';

/** How many numbers each voice takes in the table. */
export const ROW = 8;

/** Where each of a row's numbers sits. */
export enum Col {
  SHADER = 0,
  VALUES = 1,
  PHASE = 2,
  PASS = 3,
  WEIGHT = 4,
  /** 0 for no role, else 1 + the role's index among this frame's roles. */
  ROLE = 5,
  /** 1 where the voice is its role's first member this frame. */
  FIRST = 6,
}

/** The frame's voices as the kernel reads them, and their parameter values end to end. */
export interface Table {
  readonly rows: Float32Array;
  readonly values: Float32Array;
  readonly count: number;
}

/**
 * Each voice's numbers for this frame, worked out once for every subject: a voice the GPU runs
 * plays the same for all of them. The time, phase, and weight come out as the general path's
 * `contribution` and `weigh` give them.
 */
export function voiceTable<I, O>(
  mix: Mixer<I, O>,
  voices: readonly Voice<I, O>[],
  shaders: ReadonlyMap<Shader, number>,
): Table {
  const now = mix.now;
  const rows = new Float32Array(Math.max(1, voices.length) * ROW);
  const values: number[] = [];
  const roles = new Map<string, number>();
  voices.forEach((voice, k) => {
    const d = gpuDescriptor(voice.patch);
    if (d === undefined) throw new Error('blits: a voice in the GPU table has no shader');
    const o = k * ROW;
    rows[o + Col.SHADER] = shaders.get(d.shader) ?? 0;
    rows[o + Col.VALUES] = values.length;
    values.push(...d.values);
    const role = voice.spec.role;
    if (role !== undefined) {
      const known = roles.get(role);
      rows[o + Col.ROLE] = (known ?? roles.size) + 1;
      if (known === undefined) {
        roles.set(role, roles.size);
        rows[o + Col.FIRST] = 1;
      }
    }
    const raw = voice.rawAt(now, 0);
    const early = voice.before(raw, now);
    const elapsed = early && !voice.holdsFirst ? Number.NaN : voice.shownAt(raw);
    if (Number.isNaN(elapsed)) return;
    const since = mix.sinceOf(voice, 0);
    const fade = mix.envelope(voice, now, mix.shownOf(voice, since));
    rows[o + Col.PHASE] =
      elapsed < 0
        ? phaseBefore(elapsed, voice.duration)
        : phaseAt(elapsed, voice.duration, voice.passes);
    rows[o + Col.PASS] = passAt(elapsed, voice.duration, voice.passes);
    rows[o + Col.WEIGHT] = weighed(voice.weight, fade, 1);
  });
  return { rows, values: new Float32Array(values.length > 0 ? values : [0]), count: voices.length };
}
