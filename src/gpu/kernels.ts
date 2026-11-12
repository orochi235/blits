import type { Voice } from '../voice.js';
import { type Built, compile } from './compile.js';
import { hostRunner } from './hosted.js';
import { type ChannelLookup, packOf, type Runner } from './runner.js';
import { type Ready, type StandIn, standIn } from './stand-in.js';
import type { GpuComputePipeline, GpuDevice } from './webgpu.js';
import type { ChannelCode } from './wgsl/channels.js';

/** The kernel a frame folds on, and the voices it folds there. */
export interface Choice<I> {
  readonly kernel: Built['kernel'];
  readonly pipeline: GpuComputePipeline;
  readonly voices: Voice<I, unknown>[];
  /** The runner each voice runs by, in `voices` order. */
  readonly runners: readonly Runner[];
  readonly hosting: ReadonlySet<Voice<I, unknown>>;
  /** The channels the fold gives where it is on a stand-in kernel; null where it gives them all. */
  readonly gives: ReadonlySet<string> | null;
}

const NONE: ReadonlySet<never> = new Set();

/**
 * The GPU side's runners, in the order the kernels number them, and its kernels, each built once
 * for the runners met so far and the frame's channels and subject count. Every kernel carries the
 * host runner first.
 */
export class Kernels {
  /** Resolves once the kernel last asked for has compiled; rejects if it failed. */
  ready: Promise<void> = Promise.resolve();
  readonly known: Runner[] = [];
  /** Each runner's place in `known`, by key, as the table's runner column gives it. */
  readonly index = new Map<string, number>();
  private readonly built = new Map<string, Built>();
  /** Each kernel that has compiled, with what it was built for. */
  private readonly compiledOnes: Ready[] = [];

  constructor(
    private readonly device: GpuDevice,
    /** Called as a kernel finishes compiling, so the next read folds on it. */
    private readonly compiled: () => void,
  ) {}

  /** Each voice's runner, in order, numbering the ones not met before. */
  runnersOf<I>(voices: readonly Voice<I, unknown>[], codes: ChannelLookup): Runner[] {
    if (this.known.length === 0) this.meet(hostRunner(codes));
    return voices.map((v) => this.meet((packOf(v.patch, codes) as { runner: Runner }).runner));
  }

  private meet(r: Runner): Runner {
    if (!this.index.has(r.key)) {
      this.index.set(r.key, this.known.length);
      this.known.push(r);
    }
    return r;
  }

  /**
   * The kernel for every runner met, compiling it where it is new. While it compiles, the compiled
   * kernel that folds the most of the frame stands in, as `standIn` says; null where none can, or
   * it failed.
   */
  choose<I>(
    voices: Voice<I, unknown>[],
    runners: readonly Runner[],
    channels: ReadonlyMap<string, ChannelCode>,
    n: number,
    codes: ChannelLookup,
    hostable: (voice: Voice<I, unknown>) => boolean,
  ): Choice<I> | null {
    const key = `${this.known.length}|${[...channels.keys()].join(',')}|${n}`;
    let b = this.built.get(key);
    if (b === undefined) {
      const made = compile(this.device, key, this.known.slice(), channels, n, codes);
      b = made.built;
      this.built.set(key, b);
      this.ready = made.compiled;
      const ready: Ready = {
        built: b,
        count: this.known.length,
        channels: new Set(channels.keys()),
        n,
      };
      made.compiled.then(
        () => {
          this.compiledOnes.push(ready);
          this.compiled();
        },
        () => {},
      );
    }
    if (b.failed) return null;
    if (b.pipeline !== null)
      return {
        kernel: b.kernel,
        pipeline: b.pipeline,
        voices,
        runners,
        hosting: NONE,
        gives: null,
      };
    const host = hostRunner(codes);
    let s: StandIn<I> | null = null;
    for (const r of this.compiledOnes) {
      const t = standIn(r, voices, runners, this.index, channels.keys(), n, host, hostable);
      if (t !== null && (s === null || better(t, s))) s = t;
    }
    if (s === null) return null;
    const { kernel, pipeline } = s.built;
    return {
      kernel,
      pipeline: pipeline as GpuComputePipeline,
      voices: s.voices,
      runners: s.runners,
      hosting: s.hosted,
      gives: s.channels,
    };
  }

  /** Forgets every kernel. */
  clear(): void {
    this.built.clear();
    this.compiledOnes.length = 0;
  }
}

/** Whether `a` stands in better than `b`: more channels, then fewer hosted voices, then a smaller output. */
function better<I>(a: StandIn<I>, b: StandIn<I>): boolean {
  if (a.channels.size !== b.channels.size) return a.channels.size > b.channels.size;
  if (a.hosted.size !== b.hosted.size) return a.hosted.size < b.hosted.size;
  return a.built.kernel.size < b.built.kernel.size;
}
