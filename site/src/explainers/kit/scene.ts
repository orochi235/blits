import { mix } from '@blits/index';
import type { Handle, Kit, Mix, MixOptions, VoiceSpec } from '@blits/types';

/** One frame of every explainer's clock. Explainers never read a wall clock, so a run replays. */
export const FRAME = 1000 / 60;

export interface VoiceDef<I, O> {
  name: string;
  /** A CSS color, or one of the three voice slots. */
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

interface Run<I, O> {
  t: number;
  mix: Mix<I, O>;
  handles: Handle[];
  /** One single-voice mix per voice, played in step, so the ledger can itemize the fold. */
  solos: { mix: Mix<I, O>; handles: Handle[] }[];
  subjects: I[];
  voices: VoiceDef<I, O>[];
  events: SceneEvent<I, O>[];
  poses: O[];
  alone: O[];
  hidden: boolean;
  history: { t: number; values: number[] }[];
}

function cueAll<I, O>(m: Mix<I, O>, voices: VoiceDef<I, O>[]): Handle[] {
  return voices.map((v) => m.cue(v.spec));
}

/**
 * Holds one run of a scene and moves it to any time: forward by stepping frames, backward by
 * rebuilding from 0, since the explainers make their mixes without history.
 */
export class Player<I, O, C> {
  private run: Run<I, O> | null = null;

  constructor(
    private scene: Scene<I, O, C>,
    private config: C,
  ) {}

  reset(scene: Scene<I, O, C>, config: C): void {
    this.scene = scene;
    this.config = config;
    this.run = null;
  }

  private start(): Run<I, O> {
    const { scene, config } = this;
    const opts = scene.options?.(config) ?? {};
    const voices = scene.voices(config);
    const subjects = scene.subjects(config);
    const m = mix<I, O>(scene.kit, opts);
    const handles = cueAll(m, voices);
    const solos = scene.ledger
      ? voices.map((v) => {
          const solo = mix<I, O>(scene.kit, opts);
          return { mix: solo, handles: [solo.cue(v.spec)] };
        })
      : [];
    return {
      t: -FRAME,
      mix: m,
      handles,
      solos,
      subjects,
      voices,
      events: [...(scene.events?.(config) ?? [])].sort((a, b) => a.at - b.at),
      poses: subjects.map(() => ({}) as O),
      alone: voices.map(() => ({}) as O),
      hidden: false,
      history: [],
    };
  }

  private step(run: Run<I, O>, t: number): void {
    const { scene, config } = this;
    for (const e of run.events) {
      if (e.at > run.t && e.at <= t) {
        e.run(run.mix, run.handles);
        run.solos.forEach((solo, i) => {
          const only = run.handles.map((_, j) => (j === i ? solo.handles[0] : null));
          e.run(solo.mix, only.map((h) => h ?? inert) as Handle[], i);
        });
      }
    }
    run.t = t;
    if (scene.syncing && !scene.syncing(t, config)) {
      run.hidden = true;
      this.keep(run, t);
      return;
    }
    run.hidden = false;
    run.mix.sync(t);
    for (const solo of run.solos) solo.mix.sync(t);
    run.subjects.forEach((s, i) => {
      if (scene.probing && !scene.probing(t, s, config)) return;
      run.poses[i] = run.mix.probe(s, {} as O);
    });
    if (scene.ledger) {
      const focus = scene.ledger.subject(run.subjects);
      run.solos.forEach((solo, i) => {
        run.alone[i] = solo.mix.probe(focus, {} as O);
      });
    }
    this.keep(run, t);
  }

  private keep(run: Run<I, O>, t: number): void {
    if (!this.scene.record) return;
    run.history.push({ t, values: this.scene.record(run, this.config) });
    if (run.history.length > HISTORY) run.history.splice(0, run.history.length - HISTORY);
  }

  /** The frame at `t`, stepping from wherever the run is, or from 0 when `t` is behind it. */
  at(t: number): Frame<I, O> {
    if (this.run === null || t < this.run.t) this.run = this.start();
    const run = this.run;
    const target = Math.max(0, Math.floor(t / FRAME) * FRAME);
    while (run.t + FRAME <= target + 1e-6) this.step(run, run.t + FRAME);
    return {
      t: run.t,
      subjects: run.subjects,
      poses: run.poses,
      voices: run.voices,
      alone: run.alone,
      handles: run.handles,
      history: run.history,
      hidden: run.hidden,
    };
  }
}

/** Stands in for another voice's handle inside a solo mix, so an event aimed at it does nothing. */
const inert: Handle = {
  id: -1,
  state: 'done',
  weight: 0,
  rate: 1,
  seek() {},
  fade() {},
  ramp() {},
  weightOf: () => 0,
  done: Promise.resolve(),
  played: Promise.resolve(false),
};
