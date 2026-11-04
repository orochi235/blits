import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { production, warnOnce } from '../warn.js';
import { Answers, varies } from './answers.js';
import { Buffers } from './buffers.js';
import { type Built, compile, layoutOf } from './compile.js';
import { codesOf, eligibility, within } from './eligible.js';
import { GROUP, MAX_ROLES } from './kernel.js';
import type { Mirror } from './mirror.js';
import { Mirrors } from './mirrors.js';
import { type Entry, Regions } from './region.js';
import { type Packed, packOf, type Runner, unpack } from './runner.js';
import { elapsedOf, type Slot, voiceTable } from './table.js';
import { sizeOf, Timings } from './timings.js';
import { twins } from './twins.js';
import { unreadOf } from './unread.js';
import { type GpuBuffer, type GpuDevice, STORAGE_LIMIT, Usage } from './webgpu.js';
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
  /** Resolves once the kernel for the current voices has compiled; rejects if it failed. */
  ready: Promise<void> = Promise.resolve();
  private list: readonly I[] = [];
  private fieldsOf: (subject: I) => Record<string, number> = () => ({});
  private off = false;
  /** The mix's frame and change count the last fold was for: a fold is good until either moves. */
  private frame = Number.NaN;
  private stirs = Number.NaN;
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
  private readonly buffers: Buffers;
  /** Set where the values buffer may not hold what `regions` does, so all of it is written next. */
  private stale = true;
  /** Each channel's reason for staying on the CPU, said once. */
  private readonly told = new Set<string>();

  constructor(
    private readonly mix: Mixer<I, unknown>,
    private readonly device: GpuDevice,
  ) {
    this.answers = new Answers(mix);
    this.buffers = new Buffers(device);
    void device.lost.then(() => {
      this.release();
      this.ready = Promise.reject(new Error('blits: the GPU device was lost'));
      this.ready.catch(() => {});
    });
  }

  /** Destroys the GPU buffers and lets go of the patches and the mix; the side folds nothing after. */
  close(): void {
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
  }

  /**
   * The subjects the GPU folds, in the order their values sit in each channel's buffer, and the
   * numbers each shader patch reads from one, by field name (`() => ({})` where none reads any).
   * Call again when the list changes.
   */
  subjects(list: readonly I[], fieldsOf: (subject: I) => Record<string, number>): void {
    this.list = list.slice();
    this.fieldsOf = fieldsOf;
    this.frame = Number.NaN;
    this.mirrors.clear();
    this.answers.register(this.list);
    this.timings.clear();
  }

  /**
   * The buffer holding a channel's folded values this frame, or null where the GPU does not fold
   * it: a voice writing it cannot run there, the kernel is still compiling, or the device is gone.
   * The first call after a sync dispatches the frame's fold.
   */
  channel(name: string): GpuChannel | null {
    if (this.off) return null;
    if (this.mix.frame !== this.frame || this.mix.stirs !== this.stirs || this.mirrors.stirred) {
      this.frame = this.mix.frame;
      this.stirs = this.mix.stirs;
      this.outputs = new Map();
      this.dispatch();
    }
    return this.outputs.get(name) ?? null;
  }

  private dispatch(): void {
    const mix = this.mix;
    const n = this.list.length;
    if (n === 0) return;
    const e = eligibility(mix, this.answers);
    const codes = codesOf(mix);
    const limit = this.device.limits?.maxStorageBufferBindingSize ?? STORAGE_LIMIT;
    within(
      e,
      (v) => {
        const p = packOf(v.patch, codes) as Extract<Packed, { runner: Runner }>;
        const rows = p.perSubject === undefined ? 0 : n * (p.runner.stride ?? 0);
        const u = v as Voice<I, unknown>;
        const asks = varies(u as Voice<unknown, unknown>);
        const block = asks ? sizeOf(this.answers.of(u), (v.fade.in ?? 0) > 0) : 0;
        return { values: p.values.length, persub: rows + block };
      },
      limit,
    );
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
    const mirrors: (Mirror<unknown> | undefined)[] = [];
    const entries: Entry[] = e.voices.map((v) => {
      const p = packOf(v.patch, codes) as Extract<Packed, { runner: Runner }>;
      if (p.perSubject === undefined) {
        mirrors.push(undefined);
        return { owner: v, values: p.values };
      }
      const u = v as Voice<I, unknown>;
      const delays = varies(u as Voice<unknown, unknown>) ? this.answers.of(u).delays : null;
      const m = this.mirrors.of(v, p.perSubject, p.values, this.list, delays);
      // A host reading only these buffers never samples, so the changes it made are committed here.
      const now = mix.now;
      const horizon = mix.horizonFor(v, 0, now);
      const unread = unreadOf(mix, u, this.answers, this.timings);
      if (delays === null) m.prepare(elapsedOf(v, now), horizon, false, unread);
      else {
        const t = v.unstarted(now) && !v.holdsFirst ? Number.NaN : v.rawAt(now, 0);
        m.prepare(t, horizon, v.holdsFirst, unread);
      }
      mirrors.push(m as Mirror<unknown>);
      return { owner: v, values: m.values() };
    });
    // A patch packed before it met a subject could not check its axes; its mirror has met them now.
    const unfit = e.voices.filter((_, k) => {
      const m = mirrors[k];
      return m !== undefined && m.stride !== (runners[k] as Runner).stride;
    });
    if (unfit.length > 0) {
      for (const v of unfit) unpack(v.patch, codes);
      this.dispatch();
      return;
    }
    const subs = this.mirrors.place(mirrors);
    const voices = e.voices as Voice<I, unknown>[];
    const timing = this.timings.place(mix, voices, this.answers, this.mirrors.length);
    // Each fade curve's entry after every voice's, at `curves[k]` for voice k.
    const curves = voices.map((v) => {
      const c = this.timings.curveOf(v as Voice<unknown, unknown>);
      if (c === undefined) return undefined;
      entries.push(c);
      return entries.length - 1;
    });
    const placed = this.regions.frame(entries, limit / 4);
    const slots: Slot[] = runners.map((r, k) => {
      const c = curves[k];
      return {
        runner: this.index.get(r.key) as number,
        values: placed.offsets[k] as number,
        sub: subs[k] as number,
        timing: timing[k],
        ...(c === undefined ? {} : { ease: placed.offsets[c] as number }),
      };
    });
    const table = voiceTable(mix, e.voices, slots);
    if (table.roles > MAX_ROLES) {
      this.stale = true;
      warnOnce(
        this,
        `the gpu engine folds at most ${MAX_ROLES} roles a frame; the rest stay on the CPU`,
      );
      return;
    }
    const k = b.kernel;
    const buf = this.buffers;
    buf.subjects(this.list, this.fieldsOf, k.fields);
    const dev = this.device;
    const t = buf.sized('table', table.rows.byteLength, Usage.STORAGE | Usage.COPY_DST);
    const had = buf.of('values');
    const v = buf.sized('values', this.regions.length * 4, Usage.STORAGE | Usage.COPY_DST);
    const f = buf.sized('frame', 16, Usage.UNIFORM | Usage.COPY_DST);
    const out = buf.sized('out', k.size * 4, Usage.STORAGE | Usage.COPY_SRC);
    const hadSub = buf.of('persub');
    const persub = buf.sized(
      'persub',
      (this.mirrors.length + this.timings.length) * 4,
      Usage.STORAGE | Usage.COPY_DST,
    );
    dev.queue.writeBuffer(t, 0, table.rows);
    const data = this.regions.data;
    if (this.stale || v !== had) {
      if (this.regions.length > 0)
        dev.queue.writeBuffer(v, 0, data.subarray(0, this.regions.length));
      this.stale = false;
    } else
      for (const [from, to] of placed.changed)
        dev.queue.writeBuffer(v, from, data.subarray(from / 4, to / 4));
    this.mirrors.upload(dev, persub, persub !== hadSub);
    this.timings.upload(dev, persub, persub !== hadSub);
    dev.queue.writeBuffer(f, 0, new Uint32Array([table.count, n, 0, 0]));
    const group = buf.bind(b.pipeline, layoutOf(dev));
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(b.pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(n / GROUP));
    pass.end();
    dev.queue.submit([enc.finish()]);
    for (const o of k.outputs)
      this.outputs.set(o.name, {
        buffer: out,
        offset: o.offset * 4,
        stride: o.axes * 4,
        axes: o.axes,
      });
    if (production()) return;
    // Compares a sample of subjects with the CPU's fold, the first time each runner runs.
    const fresh = runners.filter((r) => !this.checked.has(r.key));
    if (fresh.length === 0) return;
    for (const r of fresh) this.checked.add(r.key);
    twins(dev, mix, this.list, k, out, fresh[0] as Runner);
  }
}
