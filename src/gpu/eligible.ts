import type { Mixer } from '../mixer.js';
import { reading } from '../reading.js';
import type { Voice } from '../voice.js';
import { type ChannelLookup, packOf } from './runner.js';
import { type ChannelCode, codeFor } from './wgsl/channels.js';

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

const lookups = new WeakMap<object, ChannelLookup>();

/** Per voice's `named`: whether it holds every subject of the list last asked about. It never changes. */
const covered = new WeakMap<object, { list: readonly unknown[]; all: boolean }>();

function coversAll<I>(named: { has(subject: I): boolean }, subjects: readonly I[]): boolean {
  const had = covered.get(named);
  if (had?.list === subjects) return had.all;
  let all = true;
  for (const s of subjects)
    if (!named.has(s)) {
      all = false;
      break;
    }
  covered.set(named, { list: subjects, all });
  return all;
}

/** The WGSL of each of the mix's channels whose rule has some, one map per mix. */
export function codesOf<I, O>(mix: Mixer<I, O>): ChannelLookup {
  let codes = lookups.get(mix);
  if (codes === undefined) {
    const made = new Map<string, ChannelCode>();
    mix.names.forEach((name, i) => {
      const code = codeFor(mix.channels[i] as never);
      if (code !== undefined) made.set(name, code);
    });
    codes = made;
    lookups.set(mix, codes);
  }
  return codes;
}

/** Why a voice cannot run on the GPU, or null where it can. */
function why<I, O>(
  voice: Voice<I, O>,
  subjects: readonly I[],
  codes: ChannelLookup,
): string | null {
  for (const name of voice.patch.writes as readonly string[])
    if (!codes.has(name)) return `it writes ${name}, whose rule the GPU has no WGSL for`;
  const packed = packOf(voice.patch, codes);
  if (packed === undefined) return `no gpu runner takes a ${voice.patch.form} patch`;
  if ('why' in packed) return packed.why;
  if (voice.motion !== undefined && reading.back !== null)
    return 'it is a motion read back through its history';
  if (voice.motion !== undefined && !reading.live)
    return 'it is a motion read by a projection, which commits nothing';
  if (voice.spec.from === 'current') return "it starts from the subject's current pose";
  if (typeof voice.spec.weight === 'function') return 'its weight is a weight signal';
  if (voice.spec.stagger !== undefined) return 'it staggers its subjects';
  if (voice.owner !== null) return 'an owner lays it out';
  if (voice.patch.state !== undefined || voice.patch.step !== undefined)
    return 'its patch keeps state';
  if (voice.parts !== null || voice.parted !== null) return 'it is parting from subjects';
  if (voice.bound !== null) return 'it is bounded';
  if (voice.named !== null && !coversAll(voice.named, subjects)) return 'it misses a subject';
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
  const codes = codesOf(mix);
  for (const name of mix.names) if (!codes.has(name)) kept.add(name);
  const playing = mix.cued.filter((v) => PLAYING.has(v.state));
  const fit = new Set<Voice<I, O>>();
  for (const voice of playing) {
    const reason = why(voice, subjects, codes);
    for (const name of voice.patch.writes as readonly string[]) {
      if (reason === null) channels.add(name);
      else kept.add(name);
    }
    if (reason === null) fit.add(voice);
    else reasons.push({ voice, why: reason });
  }
  // A channel no playing voice writes folds to its rest, which the GPU gives as well as any.
  for (const name of codes.keys()) channels.add(name);
  for (const name of kept) channels.delete(name);
  const voices = playing.filter(
    (v) => fit.has(v) && (v.patch.writes as readonly string[]).some((n) => channels.has(n)),
  );
  return { channels, voices, reasons };
}
