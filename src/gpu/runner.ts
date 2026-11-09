import type { Motions } from '../motions.js';
import { keysPack } from './runners/keys-pack.js';
import { motionPack } from './runners/motion.js';
import { wavePack } from './runners/wave.js';
import { shaderPack } from './shader-patch.js';
import type { ChannelCode } from './wgsl/channels.js';

/** One kind of patch the kernel can run: shader patches are one runner per Shader, each stock kind is one. */
export interface Runner {
  /** Stable across patches of the kind: the kernel cache key includes it. */
  readonly key: string;
  /** WGSL declarations, each included once per kernel. */
  readonly helpers: string | readonly string[];
  /**
   * The WGSL body of `fn run_<i>(phase: f32, pass_index: i32, subject: Subject, base: u32, sub: u32, lag: f32) -> Out_<i>`,
   * setting `out.<channel>` for each channel it writes. `base` is the voice's offset in `values`;
   * `sub` its offset in the per-subject buffer for this subject (0 where it has none); `lag` how
   * far this subject's shown time is behind the voice's raw time, 0 for a voice with no delays.
   */
  readonly wgsl: string;
  readonly writes: readonly string[];
  readonly fields: readonly string[];
  /** f32s each subject takes in the voice's per-subject region; absent where it has none. */
  readonly stride?: number;
}

const built = new Map<string, Runner>();

/** The runner `key` names, made by `make` the first time it is asked for. */
export function cachedRunner(key: string, make: () => Omit<Runner, 'key'>): Runner {
  let r = built.get(key);
  if (r === undefined) {
    r = { key, ...make() };
    built.set(key, r);
  }
  return r;
}

/** Why a patch stays on the CPU whose easing is a function. */
export const EASING_FUNCTION = 'its easing is a function, which the GPU cannot run';

/** What a voice reads per subject from the `persub` buffer: each subject's motion run. */
export interface PerSubject {
  readonly motions: Motions<unknown>;
}

/** Each channel's WGSL, by name: what a runner reads to pack a patch for the channels it writes. */
export type ChannelLookup = ReadonlyMap<string, ChannelCode>;

/** What a voice's patch gives the GPU, or a sentence saying why it cannot. */
export type Packed =
  | { runner: Runner; values: Float32Array; perSubject?: PerSubject }
  | { why: string };

/** A kind of patch's packer: undefined for a patch of another kind. */
type Claim = (patch: object, channels: ChannelLookup) => Packed | undefined;

const claims: readonly Claim[] = [shaderPack, wavePack, keysPack, motionPack];

const packs = new WeakMap<ChannelLookup, WeakMap<object, Packed | null>>();

/** What `patch` gives the GPU, packed once per patch, or undefined where no runner takes it. */
export function packOf(patch: object, channels: ChannelLookup): Packed | undefined {
  let by = packs.get(channels);
  if (by === undefined) {
    by = new WeakMap();
    packs.set(channels, by);
  }
  const had = by.get(patch);
  if (had !== undefined) return had ?? undefined;
  let made: Packed | undefined;
  for (const claim of claims) {
    made = claim(patch, channels);
    if (made !== undefined) break;
  }
  by.set(patch, made ?? null);
  return made;
}

/** Forgets what `patch` packed to, so the next `packOf` packs it again. */
export function unpack(patch: object, channels: ChannelLookup): void {
  packs.get(channels)?.delete(patch);
}
