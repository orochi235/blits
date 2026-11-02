import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { gpuDescriptor } from './shader-patch.js';
import { codeFor } from './wgsl/channels.js';

/** What can go on the GPU this frame, and why the rest cannot. */
export interface Eligibility<I, O> {
  /** The channels the GPU folds this frame. */
  readonly channels: Set<string>;
  /** The live voices writing those channels, in voice order. */
  readonly voices: Voice<I, O>[];
  /** For each voice that kept a channel on the CPU, a sentence saying why. */
  readonly reasons: { voice: Voice<I, O>; why: string }[];
}

const PLAYING = new Set(['live', 'frozen', 'fading']);

/** Why a voice cannot run on the GPU, or null where it can. */
function why<I, O>(voice: Voice<I, O>, subjects: readonly I[]): string | null {
  if (gpuDescriptor(voice.patch) === undefined) return 'its patch is not a shaderPatch';
  if (typeof voice.spec.weight === 'function') return 'its weight is a weight signal';
  if (voice.spec.stagger !== undefined) return 'it staggers its subjects';
  if (voice.owner !== null) return 'an owner lays it out';
  if (voice.patch.state !== undefined || voice.patch.step !== undefined)
    return 'its patch keeps state';
  if (voice.parts !== null || voice.parted !== null) return 'it is parting from subjects';
  if (voice.bound !== null) return 'it is bounded';
  const named = voice.named;
  if (named !== null) for (const s of subjects) if (!named.has(s)) return 'it misses a subject';
  return null;
}

/**
 * Sorts this frame's voices into what the GPU folds and what stays on the CPU. A channel goes on
 * the GPU when its rule has WGSL and every playing voice writing it can run there.
 */
export function eligibility<I, O>(mix: Mixer<I, O>, subjects: readonly I[]): Eligibility<I, O> {
  const channels = new Set<string>();
  const kept = new Set<string>();
  const reasons: { voice: Voice<I, O>; why: string }[] = [];
  mix.names.forEach((name, i) => {
    if (codeFor(mix.channels[i] as never) === undefined) kept.add(name);
  });
  const playing = mix.cued.filter((v) => PLAYING.has(v.state));
  for (const voice of playing) {
    const reason = why(voice, subjects);
    for (const name of voice.patch.writes as readonly string[]) {
      if (reason === null) channels.add(name);
      else kept.add(name);
    }
    if (reason !== null) reasons.push({ voice, why: reason });
  }
  for (const name of kept) channels.delete(name);
  const voices = playing.filter(
    (v) =>
      gpuDescriptor(v.patch) !== undefined &&
      (v.patch.writes as readonly string[]).some((n) => channels.has(n)),
  );
  return { channels, voices, reasons };
}
