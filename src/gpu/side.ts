import type { Mixer } from '../mixer.js';
import { reading } from '../reading.js';
import type { Voice } from '../voice.js';
import { Answers } from './answers.js';
import { overBinding, overTable } from './bounds.js';
import { Buffers } from './buffers.js';
import { codesOf, eligibility, within } from './eligible.js';
import { Hosted, hostable } from './hosted.js';
import { MAX_ROLES } from './kernel.js';
import { Kernels } from './kernels.js';
import { Met } from './met.js';
import { Mirrors } from './mirrors.js';
import { prepare, roomOf } from './prepare.js';
import { type GpuRead, Readback } from './readback.js';
import { Reads } from './reads.js';
import { type GpuReason, Reasons } from './reasons.js';
import { Regions } from './region.js';
import { submit } from './submit.js';
import { Timings } from './timings.js';
import { Twins } from './twins.js';
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
 * The GPU half of a mix the `gpu` engine made: folds the channels its voices write into a buffer,
 * once a frame, for the subjects the host registered.
 *
 * @category gpu
 */
export class GpuSide<I> {
  private list: readonly I[] = [];
  private fieldsOf: (subject: I) => Record<string, number> = () => ({});
  private off = false;
  /** The mix's frame, change count and input count the last fold was for: good until one moves. */
  private frame = Number.NaN;
  private stirs = Number.NaN;
  private inputs = Number.NaN;
  private outputs = new Map<string, GpuChannel>();
  private readonly kernels: Kernels;
  private readonly hosted = new Hosted();
  private readonly twins = new Twins();
  private readonly regions = new Regions();
  private readonly mirrors = new Mirrors();
  private answers: Answers<I>;
  private readonly timings = new Timings();
  private readonly reads = new Reads<I>();
  private readonly met: Met<I>;
  private readonly buffers: Buffers;
  /** Set where the values buffer may not hold what `regions` does, so all of it is written next. */
  private stale = true;
  /** Set where the last fold waited on a kernel compiling or failed, which no mirror's change moves. */
  private waiting = false;
  private readonly why = new Reasons();
  private readonly readback: Readback<I>;
  /** Stops `reads` following the mix's seeks. */
  private readonly unfollow: () => void;

  constructor(
    private readonly mix: Mixer<I, unknown>,
    private readonly device: GpuDevice,
  ) {
    this.answers = new Answers(mix);
    // A fold made while a kernel compiled may have shown less; the next read folds again.
    this.kernels = new Kernels(device, () => {
      this.frame = Number.NaN;
    });
    this.met = new Met(mix, () => this.answers);
    this.buffers = new Buffers(device);
    this.readback = new Readback(device);
    // Before `reads` follows a seek back, as it reads the answers made again.
    const answering = mix.onSeek((s) => {
      if (s.back) this.answers.back();
    });
    const reading = this.reads.follow(mix, () => this.answers);
    const delayed = (voice: Voice<I, unknown>) => this.timings.stage(device, voice);
    mix.delayed = delayed;
    this.unfollow = () => {
      answering();
      reading();
      if (mix.delayed === delayed) mix.delayed = null;
    };
    void device.lost.then(() => {
      this.readback.close(false);
      this.release();
      this.kernels.ready = Promise.reject(new Error('blits: the GPU device was lost'));
      this.kernels.ready.catch(() => {});
    });
  }

  /** Destroys the GPU buffers and lets go of the patches and the mix; the side folds nothing after. */
  close(): void {
    this.readback.close(true);
    this.release();
    this.buffers.destroy();
    this.answers = new Answers(this.mix);
    this.kernels.clear();
  }

  /** Stops folding, and lets go of every mirror's watch and the mix's hooks. */
  private release(): void {
    this.off = true;
    this.outputs.clear();
    this.mirrors.clear();
    this.timings.close();
    this.reads.clear();
    this.unfollow();
    this.met.close();
    this.why.clear();
  }

  /** Resolves once the kernel for the current voices has compiled; rejects if it failed. */
  get ready(): Promise<void> {
    return this.kernels.ready;
  }

  /**
   * The subjects the GPU folds, in the order their values sit in each channel's buffer, and the
   * numbers each shader patch reads from one, by field name (`() => ({})` where none reads any).
   * Call again when the list changes.
   */
  subjects(list: readonly I[], fieldsOf: (subject: I) => Record<string, number>): void {
    const was = this.list;
    this.list = Object.freeze(list.slice());
    this.reads.relist(was, this.list);
    this.fieldsOf = fieldsOf;
    this.frame = Number.NaN;
    this.mirrors.clear();
    this.answers.register(this.list);
    this.met.clear();
    this.timings.clear();
    this.readback.forget();
    this.why.clear();
  }

  /**
   * The buffer holding a channel's folded values this frame, or null where the GPU does not fold
   * it: a voice writing it cannot run there, or the device is gone. While a kernel for a runner
   * met for the first time compiles, the last kernel keeps folding, a shader patch it lacks folded
   * from its `at` on the CPU; a channel another new runner writes is null until the kernel is
   * ready. The first call after a sync dispatches the frame's fold.
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
   * frame since, the same `GpuRead` again. Only where no fold from the previous frame can be
   * copied does it wait on the current fold: after `subjects()`, after a frame that folded nothing,
   * and at a channel's first read once this frame has folded. Only channels read since the last
   * frame are copied. Where the GPU falls behind, a frame's copy is skipped and the read gives an
   * older one, its `timestamp` saying which. A read waiting across `subjects()` keeps its fold's
   * list, in `GpuRead.subjects`. Resolves `null`, never rejecting, wherever `channel(name)` is
   * null, and for reads still waiting at `close()` or device loss, though on a real loss a map that
   * settles with zeros first may not. Handed `into`, it copies the values there, if it holds them,
   * and gives it as `values`, so a host reading every frame can pass back the last read's `values`
   * and make no new array.
   */
  read(name: string, into?: Float32Array): Promise<GpuRead<I> | null> {
    if (this.off) return Promise.resolve(null);
    this.readback.want(name);
    this.refresh();
    // Wanted again: this frame's turn took the first, and the next frame's copies it.
    this.readback.want(name);
    if (!this.outputs.has(name)) return Promise.resolve(null);
    return this.readback.read(name, this.mix.frame, this.mix.seq, into);
  }

  /**
   * Each voice the last fold left on the CPU and why, plus an entry with no voice where a frame had
   * more roles than the GPU folds. Empty where everything folds, and after `subjects()`, `close()`
   * or device loss. Frozen; asking folds nothing.
   */
  reasons(): readonly GpuReason[] {
    return this.why.list;
  }

  /** Folds again if anything the last fold read has moved. */
  private refresh(): void {
    if (
      this.mix.frame === this.frame &&
      this.mix.stirs === this.stirs &&
      reading.inputs === this.inputs &&
      (this.waiting || !this.mirrors.stirred)
    )
      return;
    this.frame = this.mix.frame;
    this.stirs = this.mix.stirs;
    this.inputs = reading.inputs;
    this.outputs = new Map();
    this.readback.turn(this.mix.frame, this.mix.seq);
    this.waiting = false;
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
    this.why.note(e.reasons as { voice: Voice<I, unknown>; why: string }[]);
    if (e.channels.size === 0) return;
    const runners = this.kernels.runnersOf(e.voices as Voice<I, unknown>[], codes);
    const channels = new Map<string, ChannelCode>();
    for (const name of mix.names)
      if (e.channels.has(name)) channels.set(name, codes.get(name) as ChannelCode);
    const over = overBinding(channels, this.kernels.known, n, limit);
    if (over !== null) {
      this.why.all([...channels.keys()], over);
      return;
    }
    const c = this.kernels.choose(
      e.voices as Voice<I, unknown>[],
      runners,
      channels,
      n,
      codes,
      (v) => hostable(v, this.answers),
    );
    if (c === null) {
      this.waiting = true;
      return;
    }
    const { voices, gives } = c;
    const sample = gives === null ? this.twins.before(mix, this.list, c.runners) : null;
    const prepared = prepare({
      mix,
      voices,
      runners: c.runners,
      index: this.kernels.index,
      codes,
      list: this.list,
      answers: this.answers,
      mirrors: this.mirrors,
      timings: this.timings,
      reads: this.reads,
      regions: this.regions,
      limit,
      hosted: this.hosted,
      hosting: c.hosting,
    });
    if (prepared === 'unfit') {
      this.dispatch();
      return;
    }
    if (prepared === 'unhosted') {
      this.waiting = true;
      return;
    }
    const { table, placed } = prepared;
    const refused =
      table.roles > MAX_ROLES
        ? `the gpu engine folds at most ${MAX_ROLES} roles a frame, so in a frame with more every channel stays on the CPU`
        : overTable(table.rows.byteLength, limit);
    if (refused !== null) {
      this.stale = true;
      this.why.all([...channels.keys()], refused);
      return;
    }
    this.met.mark(voices);
    const k = c.kernel;
    const out = submit(
      {
        device: this.device,
        buffers: this.buffers,
        kernel: k,
        pipeline: c.pipeline,
        list: this.list,
        fieldsOf: this.fieldsOf,
        table,
        regions: this.regions,
        placed,
        stale: this.stale,
        mirrors: this.mirrors,
        timings: this.timings,
        reads: this.reads,
        hosted: this.hosted,
      },
      this.outputs,
    );
    if (gives !== null)
      for (const name of [...this.outputs.keys()]) if (!gives.has(name)) this.outputs.delete(name);
    const { frame, seq, now, timestamp } = mix;
    this.readback.fold({ out, outputs: this.outputs, frame, seq, now, timestamp, list: this.list });
    this.stale = false;
    this.twins.after(this.device, k, out, sample);
  }
}
