import { curveData } from '../easing.js';
import type { Mixer } from '../mixer.js';
import { reading } from '../reading.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import { type ChannelLookup, packOf } from './runner.js';
import { weightWhy } from './weight.js';
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

/**
 * Whether a voice's own weight is the number 0 and the CPU does nothing for it at that weight. A
 * role member still places its role, a voice fading to rest is still asked, and a stepping patch,
 * a `from: 'current'` voice, an owner's child and a parting one keep state at weight 0.
 */
function idle<I, O>(voice: Voice<I, O>): boolean {
  return (
    typeof voice.spec.weight !== 'function' &&
    voice.weight === 0 &&
    voice.spec.role === undefined &&
    voice.out?.rest !== true &&
    voice.patch.state === undefined &&
    voice.patch.step === undefined &&
    voice.spec.from !== 'current' &&
    voice.owner === null &&
    voice.parts === null &&
    voice.parted === null
  );
}

/** Why a voice cannot run on the GPU, or null where it can. */
function why<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  codes: ChannelLookup,
  answers: Answers<I>,
  refused?: WeakMap<object, string>,
): string | null {
  for (const name of voice.patch.writes as readonly string[])
    if (!codes.has(name)) return `it writes ${name}, whose rule the GPU has no WGSL for`;
  if (voice.axes !== null) return "it weighs a channel's axes apart";
  const packed = packOf(voice.patch, codes);
  if (packed === undefined) return `no gpu runner takes a ${voice.patch.form} patch`;
  if ('why' in packed) return packed.why;
  if (voice.motion !== undefined && reading.back !== null)
    return 'it is a motion read back through its history';
  if (voice.motion !== undefined && !reading.live)
    return 'it is a motion read by a projection, which commits nothing';
  if (voice.spec.from === 'current') return "it starts from the subject's current pose";
  const weight = weightWhy(mix, voice, refused);
  if (weight !== null) return weight;
  if (voice.patch.state !== undefined || voice.patch.step !== undefined)
    return 'its patch keeps state';
  if (voice.parts !== null || voice.parted !== null) return 'it is parting from subjects';
  if (voice.bound !== null) return 'it is bounded';
  if (!varies(voice as Voice<unknown, unknown>)) return null;
  // Asked as met, its delays raise `latest` and lower `soonest` only where a host reads subjects.
  // Said before asking, which for a large list costs a call per subject and a store of answers.
  if (voice.named === null && voice.spec.stagger !== undefined && Number.isFinite(voice.span))
    return 'its stagger is asked as subjects are met, so when it ends depends on which were read';
  const answer = answers.of(voice as Voice<I, unknown>);
  if (!answer.finite) return 'its stagger gives a subject a delay that is not a finite number';
  const delays = answer.delays;
  if (delays === null) return null;
  return staggered(voice, delays);
}

/** Why a voice that staggers its subjects cannot run on the GPU, or null where it can. */
function staggered<I, O>(voice: Voice<I, O>, delays: Float64Array): string | null {
  if (voice.named === null && !voice.beginless && delays.some((d) => d < 0))
    return 'its stagger is asked as subjects are met and gives some a negative delay, so where it ends running back depends on which were read';
  if ((voice.fade.in ?? 0) > 0) {
    if (curveData(voice.ease) === undefined)
      return 'its fade in eases by a function, which the GPU cannot run';
    if (voice.stalls !== null)
      return 'its fade in stalled where a fade out turned back, and its subjects start at different times';
  }
  return null;
}

/**
 * Sorts this frame's voices into what the GPU folds and what stays on the CPU. A channel goes on
 * the GPU when its rule has WGSL and every playing voice writing it can run there or is idle.
 */
export function eligibility<I, O>(
  mix: Mixer<I, O>,
  answers: Answers<I>,
  refused?: WeakMap<object, string>,
): Eligibility<I, O> {
  const channels = new Set<string>();
  const kept = new Set<string>();
  const reasons: { voice: Voice<I, O>; why: string }[] = [];
  const codes = codesOf(mix);
  for (const name of mix.names) if (!codes.has(name)) kept.add(name);
  // An owner writes nothing itself: its weight and clock reach the GPU through its children's rows.
  const playing = mix.cued.filter((v) => v.holding === null && PLAYING.has(v.state) && !idle(v));
  const fit = new Set<Voice<I, O>>();
  for (const voice of playing) {
    const reason = why(mix, voice, codes, answers, refused);
    for (const name of voice.patch.writes as readonly string[]) {
      if (reason === null) channels.add(name);
      else kept.add(name);
    }
    if (reason === null) fit.add(voice);
    else reasons.push({ voice, why: reason });
  }
  meanTurns(mix, playing, kept, reasons);
  // A channel no playing voice writes folds to its rest, which the GPU gives as well as any.
  for (const name of codes.keys()) channels.add(name);
  for (const name of kept) channels.delete(name);
  const voices = playing.filter(
    (v) => fit.has(v) && (v.patch.writes as readonly string[]).some((n) => channels.has(n)),
  );
  return { channels, voices, reasons };
}

/**
 * Keeps on the CPU each angle channel that three or more members of one role write: there they
 * meet at their mean direction, which takes every member at once, where the kernel lerps them in
 * one by one. Two members meet the same either way.
 */
function meanTurns<I, O>(
  mix: Mixer<I, O>,
  playing: readonly Voice<I, O>[],
  kept: Set<string>,
  reasons: { voice: Voice<I, O>; why: string }[],
): void {
  mix.turns.forEach((turn, slot) => {
    if (!(turn > 0)) return;
    const name = mix.names[slot] as string;
    if (kept.has(name)) return;
    const roles = new Map<string, Voice<I, O>[]>();
    for (const v of playing) {
      const role = v.spec.role;
      if (role === undefined || !v.slots.includes(slot)) continue;
      const at = roles.get(role);
      if (at === undefined) roles.set(role, [v]);
      else at.push(v);
    }
    for (const members of roles.values()) {
      if (members.length < 3) continue;
      kept.add(name);
      for (const voice of members)
        reasons.push({
          voice,
          why: `its role blends ${name} from three or more angles, which meet at their mean direction on the CPU`,
        });
    }
  });
}

/** f32s a voice takes in the values buffer and in the per-subject buffer. */
export interface Room {
  readonly values: number;
  readonly persub: number;
}

/**
 * Keeps on the CPU, with a reason, each voice that would take the values or per-subject buffer past
 * `limit` bytes, the largest storage buffer the device binds, and every channel it writes.
 */
export function within<I, O>(
  e: Eligibility<I, O>,
  room: (voice: Voice<I, O>) => Room,
  limit: number,
): void {
  let values = 0;
  let persub = 0;
  const out = new Set<Voice<I, O>>();
  for (const voice of e.voices) {
    const r = room(voice);
    let why: string | null = null;
    if ((values + r.values) * 4 > limit)
      why = 'its numbers would take the values buffer past the largest the device binds';
    else if ((persub + r.persub) * 4 > limit)
      why =
        "its subjects' runs would take the per-subject buffer past the largest the device binds";
    if (why === null) {
      values += r.values;
      persub += r.persub;
      continue;
    }
    out.add(voice);
    e.reasons.push({ voice, why });
    for (const name of voice.patch.writes as readonly string[]) e.channels.delete(name);
  }
  if (out.size === 0) return;
  const fits = e.voices.filter(
    (v) => !out.has(v) && (v.patch.writes as readonly string[]).some((n) => e.channels.has(n)),
  );
  e.voices.splice(0, e.voices.length, ...fits);
}
