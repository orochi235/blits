import type { Mixer } from '../mixer.js';
import { production, warnOnce } from '../warn.js';
import { eligibility } from './eligible.js';
import { GROUP, type Kernel, kernel, MAX_ROLES } from './kernel.js';
import { gpuDescriptor, type Shader } from './shader-patch.js';
import { voiceTable } from './table.js';
import {
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuComputePipeline,
  type GpuDevice,
  MAP_READ,
  Usage,
} from './webgpu.js';
import { type ChannelCode, codeFor } from './wgsl/channels.js';

declare const console: { error(message: string): void };

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

interface Built {
  readonly kernel: Kernel;
  pipeline: GpuComputePipeline | null;
  failed: boolean;
}

/** Twin check tolerances: what f32 math and the order of its operations leave apart from f64. */
const RELATIVE = 1e-4;
/** Absolute tolerance: a color's trip through linear sRGB and back leaves about 4e-4 in f32. */
const ABSOLUTE = 1e-3;
const SAMPLES = 16;

/**
 * The GPU half of a mix the `gpu` engine made: folds the channels its shader patches' voices write
 * into a buffer, once a frame, for the subjects the host registered.
 *
 * @category gpu
 */
export class GpuSide<I> {
  /** Resolves once the kernel for the current voices has compiled; rejects if it failed. */
  ready: Promise<void> = Promise.resolve();
  private list: readonly I[] = [];
  private fieldsOf: (subject: I) => Record<string, number> = () => ({});
  private off = false;
  private frame = Number.NaN;
  private outputs = new Map<string, GpuChannel>();
  private readonly known: Shader[] = [];
  private readonly index = new Map<Shader, number>();
  private readonly built = new Map<string, Built>();
  private readonly checked = new Set<Shader>();
  /** Each channel's reason for staying on the CPU, said once. */
  private readonly told = new Set<string>();
  private uploaded: { list: readonly I[]; fields: readonly string[] } | null = null;
  private buffers: Partial<Record<'subjects' | 'table' | 'values' | 'frame' | 'out', GpuBuffer>> =
    {};
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
   * numbers each shader patch reads from one, by field name. Call again when the list changes.
   */
  subjects(list: readonly I[], fieldsOf: (subject: I) => Record<string, number>): void {
    this.list = list.slice();
    this.fieldsOf = fieldsOf;
    this.uploaded = null;
    this.frame = Number.NaN;
  }

  /**
   * The buffer holding a channel's folded values this frame, or null where the GPU does not fold
   * it: a voice writing it cannot run there, the kernel is still compiling, or the device is gone.
   * The first call after a sync dispatches the frame's fold.
   */
  channel(name: string): GpuChannel | null {
    if (this.off) return null;
    if (this.mix.frame !== this.frame) {
      this.frame = this.mix.frame;
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
    for (const v of e.voices) {
      const shader = gpuDescriptor(v.patch)?.shader as Shader;
      if (!this.index.has(shader)) {
        this.index.set(shader, this.known.length);
        this.known.push(shader);
      }
    }
    const channels = new Map<string, ChannelCode>();
    mix.names.forEach((name, i) => {
      if (e.channels.has(name))
        channels.set(name, codeFor(mix.channels[i] as never) as ChannelCode);
    });
    const types = new Map<string, ChannelCode>();
    mix.names.forEach((name, i) => {
      const code = codeFor(mix.channels[i] as never);
      if (code !== undefined) types.set(name, code);
    });
    const key = `${this.known.length}|${[...channels.keys()].join(',')}|${n}`;
    let b = this.built.get(key);
    if (b === undefined) {
      b = this.build(key, channels, n, types);
      this.built.set(key, b);
    }
    if (b.pipeline === null || b.failed) return;
    const table = voiceTable(mix, e.voices, this.index);
    if (table.roles > MAX_ROLES) {
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
    const v = this.sized('values', table.values.byteLength, Usage.STORAGE | Usage.COPY_DST);
    const f = this.sized('frame', 16, Usage.UNIFORM | Usage.COPY_DST);
    const out = this.sized('out', k.size * 4, Usage.STORAGE | Usage.COPY_SRC);
    dev.queue.writeBuffer(t, 0, table.rows);
    dev.queue.writeBuffer(v, 0, table.values);
    dev.queue.writeBuffer(f, 0, new Uint32Array([table.count, n, 0, 0]));
    if (this.group === null || this.group.of !== b.pipeline) {
      this.group = {
        of: b.pipeline,
        group: dev.createBindGroup({
          layout: this.layout(),
          entries: [buf.subjects, t, v, f, out].map((buffer, binding) => ({
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
    if (!production())
      this.twins(
        e.voices.map((x) => gpuDescriptor(x.patch)?.shader as Shader),
        k,
        out,
      );
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

  private bound: GpuBindGroupLayout | null = null;

  /** The kernel's bindings, given outright: 'auto' would drop the values buffer a kernel with no parameters never reads. */
  private layout(): GpuBindGroupLayout {
    const COMPUTE = 4;
    const type = [
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'uniform',
      'storage',
    ];
    this.bound ??= this.device.createBindGroupLayout({
      entries: type.map((t, binding) => ({ binding, visibility: COMPUTE, buffer: { type: t } })),
    });
    return this.bound;
  }

  private build(
    key: string,
    channels: Map<string, ChannelCode>,
    n: number,
    types: Map<string, ChannelCode>,
  ): Built {
    const k = kernel(this.known.slice(), channels, n, types);
    const b: Built = { kernel: k, pipeline: null, failed: false };
    const module = this.device.createShaderModule({ code: k.code, label: `blits gpu ${key}` });
    const compiled = this.device
      .createComputePipelineAsync({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout()] }),
        compute: { module, entryPoint: 'main' },
        label: key,
      })
      .then(
        (p) => {
          b.pipeline = p;
        },
        async (err: unknown) => {
          b.failed = true;
          const info = await module.getCompilationInfo?.();
          const said =
            info?.messages.map((m) => `line ${m.lineNum}: ${m.message}`).join('\n') ?? String(err);
          console.error(
            `blits: the gpu engine's kernel did not compile; its channels stay on the CPU\n${said}`,
          );
          throw err;
        },
      );
    this.ready = compiled;
    compiled.catch(() => {});
    return b;
  }

  /** Compares a sample of subjects with the CPU's fold, the first time each shader runs. */
  private twins(shaders: readonly Shader[], k: Kernel, out: GpuBuffer): void {
    const fresh = shaders.filter((s) => !this.checked.has(s));
    if (fresh.length === 0) return;
    for (const s of fresh) this.checked.add(s);
    const n = this.list.length;
    const picks = [
      ...new Set(
        Array.from({ length: Math.min(SAMPLES, n) }, (_, j) =>
          Math.floor((j * (n - 1)) / Math.max(1, SAMPLES - 1)),
        ),
      ),
    ];
    const read = this.device.createBuffer({
      size: k.size * 4,
      usage: Usage.MAP_READ | Usage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(out, 0, read, 0, k.size * 4);
    this.device.queue.submit([enc.finish()]);
    const subjects = picks.map((i) => this.list[i] as I);
    const cpu = subjects.map((s) => ({ ...(this.mix.probe(s) as Record<string, unknown>) }));
    void read.mapAsync(MAP_READ).then(() => {
      const got = new Float32Array(read.getMappedRange().slice(0));
      read.unmap();
      read.destroy();
      for (const o of k.outputs)
        picks.forEach((i, j) => {
          const want = cpu[j]?.[o.name];
          const wants =
            typeof want === 'number' ? [want] : Array.isArray(want) ? (want as number[]) : [];
          for (let a = 0; a < o.axes; a++) {
            const g = got[o.offset + i * o.axes + a] as number;
            const w = wants[a] ?? Number.NaN;
            if (Math.abs(g - w) > ABSOLUTE + RELATIVE * Math.abs(w))
              warnOnce(
                fresh[0] as Shader,
                `a shader patch writing ${o.name} gives ${g} on the GPU and ${w} on the CPU for subject ${i}; its wgsl and at disagree`,
              );
          }
        });
    });
  }
}
