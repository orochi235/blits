import {
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuComputePipeline,
  type GpuDevice,
  STORAGE_LIMIT,
  Usage,
} from './webgpu.js';

/** The GPU side's buffers, in the kernel's binding order. */
const NAMES = ['subjects', 'table', 'values', 'frame', 'out', 'persub'] as const;
type Name = (typeof NAMES)[number];

/** The GPU side's buffers, each grown as needed, and the bind group over them. */
export class Buffers {
  private readonly made: Partial<Record<Name, GpuBuffer>> = {};
  private group: { of: GpuComputePipeline; group: GpuBindGroup } | null = null;
  private uploaded: { list: readonly unknown[]; fields: readonly string[] } | null = null;

  constructor(private readonly device: GpuDevice) {}

  /** The buffer called `name`, or undefined before the first `sized`. */
  of(name: Name): GpuBuffer | undefined {
    return this.made[name];
  }

  /** A buffer at least `bytes` long, made again (and the bind group with it) when it is too small. */
  sized(name: Name, bytes: number, usage: number): GpuBuffer {
    const have = this.made[name];
    if (have !== undefined && have.size >= bytes) return have;
    have?.destroy();
    const limit = this.device.limits?.maxStorageBufferBindingSize ?? STORAGE_LIMIT;
    const size = Math.max(
      16,
      Math.min(2 ** Math.ceil(Math.log2(Math.max(bytes, 1))), Math.max(bytes, limit)),
    );
    const made = this.device.createBuffer({ size, usage, label: `blits gpu ${name}` });
    this.made[name] = made;
    this.group = null;
    return made;
  }

  /** Writes each subject's `fields`, in the kernel's order, where the list or the fields changed. */
  subjects<I>(
    list: readonly I[],
    fieldsOf: (subject: I) => Record<string, number>,
    fields: readonly string[],
  ): void {
    const u = this.uploaded;
    if (u !== null && u.list === list && u.fields.join() === fields.join()) return;
    const width = Math.max(1, fields.length);
    const data = new Float32Array(list.length * width);
    list.forEach((s, i) => {
      const f = fieldsOf(s);
      fields.forEach((name, j) => {
        data[i * width + j] = f[name] ?? 0;
      });
    });
    const b = this.sized('subjects', data.byteLength, Usage.STORAGE | Usage.COPY_DST);
    this.device.queue.writeBuffer(b, 0, data);
    this.uploaded = { list, fields };
  }

  /** Destroys every buffer made, and forgets the bind group and what was uploaded. */
  destroy(): void {
    for (const name of NAMES) {
      this.made[name]?.destroy();
      delete this.made[name];
    }
    this.group = null;
    this.uploaded = null;
  }

  /** The bind group over every buffer for `pipeline`, made again where a buffer or it changed. */
  bind(pipeline: GpuComputePipeline, layout: GpuBindGroupLayout): GpuBindGroup {
    if (this.group === null || this.group.of !== pipeline)
      this.group = {
        of: pipeline,
        group: this.device.createBindGroup({
          layout,
          entries: NAMES.map((name, binding) => ({
            binding,
            resource: { buffer: this.made[name] as GpuBuffer },
          })),
        }),
      };
    return this.group.group;
  }
}
