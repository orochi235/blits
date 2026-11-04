import type { Mixer } from '../mixer.js';
import { production, warnOnce } from '../warn.js';
import { type Built, compile, layoutOf } from './compile.js';
import { codesOf, eligibility } from './eligible.js';
import { GROUP, type Kernel, MAX_ROLES } from './kernel.js';
import type { Mirror } from './mirror.js';
import { Mirrors } from './mirrors.js';
import { type Entry, Regions } from './region.js';
import { type Packed, packOf, type Runner } from './runner.js';
import { elapsedOf, type Slot, voiceTable } from './table.js';
import { twins } from './twins.js';
import {
  type GpuBindGroup,
  type GpuBuffer,
  type GpuComputePipeline,
  type GpuDevice,
  Usage,
} from './webgpu.js';
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
  /** Set where the values buffer may not hold what `regions` does, so all of it is written next. */
  private stale = true;
  /** Each channel's reason for staying on the CPU, said once. */
  private readonly told = new Set<string>();
  private uploaded: { list: readonly I[]; fields: readonly string[] } | null = null;
  private buffers: Partial<
    Record<'subjects' | 'table' | 'values' | 'frame' | 'out' | 'persub', GpuBuffer>
  > = {};
  private group: { of: GpuComputePipeline; group: GpuBindGroup } | null = null;

  constructor(
    private readonly mix: Mixer<I, unknown>,
    private readonly device: GpuDevice,
  ) {
    void device.lost.then(() => {
      this.off = true;
      this.outputs.clear();
      this.ready = Promise.reject(new Error('blits: the GPU device was lost'));
      this.ready.catch(() => {});
    });
  }

  /**
   * The subjects the GPU folds, in the order their values sit in each channel's buffer, and the
   * numbers each shader patch reads from one, by field name (`() => ({})` where none reads any).
   * Call again when the list changes.
   */
  subjects(list: readonly I[], fieldsOf: (subject: I) => Record<string, number>): void {
    this.list = list.slice();
    this.fieldsOf = fieldsOf;
    this.uploaded = null;
    this.frame = Number.NaN;
    this.mirrors.clear();
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
    const e = eligibility(mix, this.list);
    for (const r of e.reasons) {
      const key = `${(r.voice.patch.writes as readonly string[]).join(',')}: ${r.why}`;
      if (this.told.has(key)) continue;
      this.told.add(key);
      warnOnce(r.voice, `${key}, so the gpu engine leaves it on the CPU`);
    }
    if (e.channels.size === 0) return;
    const codes = codesOf(mix);
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
      const m = this.mirrors.of(v, p.perSubject, p.values, this.list);
      // A host reading only these buffers never samples, so the changes it made are committed here.
      m.prepare(elapsedOf(v, mix.now), mix.horizonFor(v, 0, mix.now));
      mirrors.push(m as Mirror<unknown>);
      return { owner: v, values: m.values() };
    });
    const placed = this.regions.frame(entries);
    const subs = this.mirrors.place(mirrors);
    const slots: Slot[] = runners.map((r, k) => ({
      runner: this.index.get(r.key) as number,
      values: placed.offsets[k] as number,
      sub: subs[k] as number,
    }));
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
    this.upload(k);
    const dev = this.device;
    const buf = this.buffers;
    const t = this.sized('table', table.rows.byteLength, Usage.STORAGE | Usage.COPY_DST);
    const had = buf.values;
    const v = this.sized('values', this.regions.length * 4, Usage.STORAGE | Usage.COPY_DST);
    const f = this.sized('frame', 16, Usage.UNIFORM | Usage.COPY_DST);
    const out = this.sized('out', k.size * 4, Usage.STORAGE | Usage.COPY_SRC);
    const hadSub = buf.persub;
    const persub = this.sized('persub', this.mirrors.length * 4, Usage.STORAGE | Usage.COPY_DST);
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
    dev.queue.writeBuffer(f, 0, new Uint32Array([table.count, n, 0, 0]));
    if (this.group === null || this.group.of !== b.pipeline) {
      this.group = {
        of: b.pipeline,
        group: dev.createBindGroup({
          layout: layoutOf(dev),
          entries: [buf.subjects, t, v, f, out, persub].map((buffer, binding) => ({
            binding,
            resource: { buffer: buffer as GpuBuffer },
          })),
        }),
      };
    }
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(b.pipeline);
    pass.setBindGroup(0, this.group.group);
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

  /** A buffer at least `bytes` long, made again (and the bind group with it) when it is too small. */
  private sized(name: keyof GpuSide<I>['buffers'], bytes: number, usage: number): GpuBuffer {
    const have = this.buffers[name];
    if (have !== undefined && have.size >= bytes) return have;
    have?.destroy();
    const size = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(bytes, 1))));
    const made = this.device.createBuffer({ size, usage, label: `blits gpu ${name}` });
    this.buffers[name] = made;
    this.group = null;
    return made;
  }

  /** Writes each subject's fields, in the kernel's order, where the list or the fields changed. */
  private upload(k: Kernel): void {
    const u = this.uploaded;
    if (u !== null && u.list === this.list && u.fields.join() === k.fields.join()) return;
    const width = Math.max(1, k.fields.length);
    const data = new Float32Array(this.list.length * width);
    this.list.forEach((s, i) => {
      const f = this.fieldsOf(s);
      k.fields.forEach((name, j) => {
        data[i * width + j] = f[name] ?? 0;
      });
    });
    const b = this.sized('subjects', data.byteLength, Usage.STORAGE | Usage.COPY_DST);
    this.device.queue.writeBuffer(b, 0, data);
    this.uploaded = { list: this.list, fields: k.fields };
  }
}
