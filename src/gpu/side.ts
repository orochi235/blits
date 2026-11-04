import type { Mixer } from '../mixer.js';
import { reading } from '../reading.js';
import type { Voice } from '../voice.js';
import { production, warnOnce } from '../warn.js';
import { Answers } from './answers.js';
import { Buffers } from './buffers.js';
import { type Built, compile } from './compile.js';
import { codesOf, eligibility, within } from './eligible.js';
import { MAX_ROLES } from './kernel.js';
import { Met } from './met.js';
import { Mirrors } from './mirrors.js';
import { prepare, roomOf } from './prepare.js';
import { type GpuRead, Readback } from './readback.js';
import { Reads } from './reads.js';
import { Regions } from './region.js';
import { packOf, type Runner } from './runner.js';
import { submit } from './submit.js';
import { Timings } from './timings.js';
import { twins } from './twins.js';
import { type GpuBuffer, type GpuDevice, STORAGE_LIMIT } from './webgpu.js';
import type { ChannelCode } from './wgsl/channels.js';

/**
 * Where a channel's folded values sit in the GPU side's output buffer: each subject's `axes`
 * numbers, `stride` bytes apart, from byte `offset`.
 *
 * @category gpu
 */
export interface GpuChannel {
  readonly buffer: GpuBuffer;
  readonly offset: number;
  readonly stride: number;
  readonly axes: number;
}

/**
 * A voice the gpu engine's last fold left on the CPU: its `name` (undefined where it has none), the
 * channels it writes, and why.
 *
 * @category gpu
 */
export interface GpuReason {
  readonly voice: string | undefined;
  readonly channels: readonly string[];
  readonly why: string;
}

/**
 * The GPU half of a mix the `gpu` engine made: folds the channels its voices write into a buffer,
 * once a frame, for the subjects the host registered.
 *
 * @category gpu
 */
export class GpuSide<I> {
  /** Resolves once the kernel for the current voices has compiled; rejects if it failed. */
  ready: Promise<void> = Promise.resolve();
  private list: readonly I[] = [];
  private fieldsOf: (subject: I) => Record<string, number> = () => ({});
  private off = false;
  /** The mix's frame, change count and input count the last fold was for: good until one moves. */
  private frame = Number.NaN;
  private stirs = Number.NaN;
  private inputs = Number.NaN;
  private outputs = new Map<string, GpuChannel>();
  private readonly known: Runner[] = [];
  /** Each runner's place in `known`, by key, as the table's runner column gives it. */
  private readonly index = new Map<string, number>();
  private readonly built = new Map<string, Built>();
  private readonly checked = new Set<string>();
  private readonly regions = new Regions();
  private readonly mirrors = new Mirrors();
  private answers: Answers<I>;
  private readonly timings = new Timings();
  private readonly reads = new Reads<I>();
  private readonly met: Met<I>;
  private readonly buffers: Buffers;
  /** Set where the values buffer may not hold what `regions` does, so all of it is written next. */
  private stale = true;
  /** Each channel's reason for staying on the CPU, said once. */
  private readonly told = new Set<string>();
  private why: readonly GpuReason[] = [];
  private readonly readback: Readback<I>;

  constructor(
    private readonly mix: Mixer<I, unknown>,
    private readonly device: GpuDevice,
  ) {
    this.answers = new Answers(mix);
    this.met = new Met(mix, () => this.answers);
    this.buffers = new Buffers(device);
    this.readback = new Readback(device);
    void device.lost.then(() => {
      this.readback.close(false);
      this.release();
      this.ready = Promise.reject(new Error('blits: the GPU device was lost'));
      this.ready.catch(() => {});
    });
  }

  /** Destroys the GPU buffers and lets go of the patches and the mix; the side folds nothing after. */
  close(): void {
    this.readback.close(true);
    this.release();
    this.buffers.destroy();
    this.answers = new Answers(this.mix);
    this.built.clear();
  }

  /** Stops folding, and lets go of every mirror's watch and the mix's `reorigined`. */
  private release(): void {
    this.off = true;
    this.outputs.clear();
    this.mirrors.clear();
    this.timings.close();
    this.reads.clear();
    this.met.close();
  }

  /**
   * The subjects the GPU folds, in the order their values sit in each channel's buffer, and the
   * numbers each shader patch reads from one, by field name (`() => ({})` where none reads any).
   * Call again when the list changes.
   */
  subjects(list: readonly I[], fieldsOf: (subject: I) => Record<string, number>): void {
    this.list = Object.freeze(list.slice());
    this.fieldsOf = fieldsOf;
    this.frame = Number.NaN;
    this.mirrors.clear();
    this.answers.register(this.list);
    this.timings.clear();
    this.reads.clear();
    this.readback.forget();
  }

  /**
   * The buffer holding a channel's folded values this frame, or null where the GPU does not fold
   * it: a voice writing it cannot run there, the kernel is still compiling, or the device is gone.
   * The first call after a sync dispatches the frame's fold.
   */
  channel(name: string): GpuChannel | null {
    if (this.off) return null;
    this.refresh();
    return this.outputs.get(name) ?? null;
  }

  /**
   * Resolves with a channel's values for the registered subjects, copied back from the GPU, from
   * the previous frame, so the frame being folded never waits on it. A sync, a seek, or a control
   * change, drop or touch starts a frame; with several folds in one, the last counts. With no new
   * frame since, the same `GpuRead` again. A first read of a channel, or the first after a gap or
   * `subjects()`, waits on the current fold instead. Only channels read since the last frame are
   * copied. Where the GPU falls behind, a frame's copy is skipped and the read gives an older one,
   * its `timestamp` saying which. A read waiting across `subjects()` keeps its fold's list, in
   * `GpuRead.subjects`. Resolves `null`, never rejecting, wherever `channel(name)` is null, and for
   * reads still waiting at `close()` or device loss, though on a real loss a map that settles with
   * zeros first may not.
   */
  read(name: string): Promise<GpuRead<I> | null> {
    if (this.off) return Promise.resolve(null);
    this.readback.want(name);
    this.refresh();
    // Wanted again: this frame's turn took the first, and the next frame's copies it.
    this.readback.want(name);
    if (!this.outputs.has(name)) return Promise.resolve(null);
    return this.readback.read(name, this.mix.frame, this.mix.seq);
  }

  /** Each voice the last fold left on the CPU, and why; empty where every voice folds. Folds nothing. */
  reasons(): readonly GpuReason[] {
    return this.why;
  }

  /** Folds again if anything the last fold read has moved. */
  private refresh(): void {
    if (
      this.mix.frame === this.frame &&
      this.mix.stirs === this.stirs &&
      reading.inputs === this.inputs &&
      !this.mirrors.stirred
    )
      return;
    this.frame = this.mix.frame;
    this.stirs = this.mix.stirs;
    this.inputs = reading.inputs;
    this.outputs = new Map();
    this.readback.turn(this.mix.frame);
    this.dispatch();
  }

  private dispatch(): void {
    const mix = this.mix;
    const n = this.list.length;
    if (n === 0) return;
    const e = eligibility(mix, this.answers, this.reads.refused);
    const codes = codesOf(mix);
    const limit = this.device.limits?.maxStorageBufferBindingSize ?? STORAGE_LIMIT;
    within(e, (v) => roomOf(v, codes, n, this.answers), limit);
    if (!this.reads.read(mix, e.voices as Voice<I, unknown>[], this.list, this.answers)) {
      this.dispatch();
      return;
    }
    this.why = e.reasons.map((r) => ({
      voice: r.voice.spec.name,
      channels: [...(r.voice.patch.writes as readonly string[])],
      why: r.why,
    }));
    for (const r of e.reasons) {
      const key = `${(r.voice.patch.writes as readonly string[]).join(',')}: ${r.why}`;
      if (this.told.has(key)) continue;
      this.told.add(key);
      warnOnce(r.voice, `${key}, so the gpu engine leaves it on the CPU`);
    }
    if (e.channels.size === 0) return;
    const runners = e.voices.map((v) => {
      const r = (packOf(v.patch, codes) as { runner: Runner }).runner;
      if (!this.index.has(r.key)) {
        this.index.set(r.key, this.known.length);
        this.known.push(r);
      }
      return r;
    });
    const channels = new Map<string, ChannelCode>();
    for (const name of mix.names)
      if (e.channels.has(name)) channels.set(name, codes.get(name) as ChannelCode);
    const key = `${this.known.length}|${[...channels.keys()].join(',')}|${n}`;
    let b = this.built.get(key);
    if (b === undefined) {
      const made = compile(this.device, key, this.known.slice(), channels, n, codes);
      b = made.built;
      this.built.set(key, b);
      this.ready = made.compiled;
      // A fold made while this compiled had nothing to show; the next read folds again.
      made.compiled.then(
        () => {
          this.frame = Number.NaN;
        },
        () => {},
      );
    }
    if (b.pipeline === null || b.failed) return;
    const voices = e.voices as Voice<I, unknown>[];
    const prepared = prepare({
      mix,
      voices,
      runners,
      index: this.index,
      codes,
      list: this.list,
      answers: this.answers,
      mirrors: this.mirrors,
      timings: this.timings,
      reads: this.reads,
      regions: this.regions,
      limit,
    });
    if (prepared === 'unfit') {
      this.dispatch();
      return;
    }
    const { table, placed } = prepared;
    if (table.roles > MAX_ROLES) {
      this.stale = true;
      warnOnce(
        this,
        `the gpu engine folds at most ${MAX_ROLES} roles a frame; the rest stay on the CPU`,
      );
      return;
    }
    this.met.mark(voices);
    const k = b.kernel;
    const out = submit(
      {
        device: this.device,
        buffers: this.buffers,
        kernel: k,
        pipeline: b.pipeline,
        list: this.list,
        fieldsOf: this.fieldsOf,
        table,
        regions: this.regions,
        placed,
        stale: this.stale,
        mirrors: this.mirrors,
        timings: this.timings,
        reads: this.reads,
      },
      this.outputs,
    );
    const { frame, seq, now, timestamp } = mix;
    this.readback.fold({ out, outputs: this.outputs, frame, seq, now, timestamp, list: this.list });
    this.stale = false;
    if (production()) return;
    // Compares a sample of subjects with the CPU's fold, the first time each runner runs.
    const fresh = runners.filter((r) => !this.checked.has(r.key));
    if (fresh.length === 0) return;
    for (const r of fresh) this.checked.add(r.key);
    twins(this.device, mix, this.list, k, out, fresh[0] as Runner);
  }
}
