import type { Handle, Kit, Mix, MixOptions, VoiceSpec } from '@msb235/blits';

/** One frame of every explainer's clock. Explainers never read a wall clock, so a run replays. */
export const FRAME = 1000 / 60;

export interface VoiceDef<I, O> {
  name: string;
  /** A CSS color, or one of the voice slots, `v1`..`v5`. */
  color: string;
  spec: VoiceSpec<I, O>;
}

export interface SceneEvent<I, O> {
  /** Explainer ms at which this runs, once, before that frame's sync. */
  at: number;
  /**
   * Runs against the main mix with `solo` undefined, then against each voice's solo mix with its
   * index; there `handles` holds that voice's handle at its own index and inert ones elsewhere.
   */
  run(mix: Mix<I, O>, handles: Handle[], solo?: number): void;
}

/** Everything an explainer declares; the kit owns the mix, the clock and the replay. */
export interface Scene<I, O, C> {
  kit: Kit<O>;
  subjects(config: C): I[];
  voices(config: C): VoiceDef<I, O>[];
  options?(config: C): MixOptions;
  /** Things that happen at a time: a fade, a retarget, a cue. */
  events?(config: C): SceneEvent<I, O>[];
  /** Whether the host syncs at this time. False models a hidden tab: no frames at all. */
  syncing?(t: number, config: C): boolean;
  /** Whether the host probes this subject at this time. False leaves it unasked. */
  probing?(t: number, subject: I, config: C): boolean;
  /**
   * Values to keep a history of, taken after every frame's probes, for a trace. The kit keeps the
   * last `HISTORY` frames of them.
   */
  record?(frame: { t: number; subjects: I[]; poses: O[]; alone: O[] }, config: C): number[];
  /** The subject the ledger itemizes, and the channels it shows. */
  ledger?: { subject(subjects: I[]): I; channels: readonly (keyof O & string)[] };
}

export interface Frame<I, O> {
  t: number;
  subjects: I[];
  /** The folded pose per subject, as last probed. */
  poses: O[];
  voices: VoiceDef<I, O>[];
  /** Per voice, the ledger subject's pose with that voice alone in the mix. */
  alone: O[];
  handles: Handle[];
  /** What `record` returned, oldest first, one entry per frame. */
  history: { t: number; values: number[] }[];
  /** True while `syncing` says the host is getting no frames. */
  hidden: boolean;
}

/** How many frames of `record` a run keeps: ten seconds. */
export const HISTORY = 600;
