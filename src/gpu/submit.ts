import type { Buffers } from './buffers.js';
import { layoutOf } from './compile.js';
import { GROUP, type Kernel } from './kernel.js';
import type { Mirrors } from './mirrors.js';
import type { Reads } from './reads.js';
import type { Placement, Regions } from './region.js';
import type { GpuChannel } from './side.js';
import type { Table } from './table.js';
import type { Timings } from './timings.js';
import { type GpuBuffer, type GpuComputePipeline, type GpuDevice, Usage } from './webgpu.js';

/** What a fold hands the GPU: the frame's table, the data it points into, and the kernel to run. */
export interface Submission<I> {
  readonly device: GpuDevice;
  readonly buffers: Buffers;
  readonly kernel: Kernel;
  readonly pipeline: GpuComputePipeline;
  readonly list: readonly I[];
  readonly fieldsOf: (subject: I) => Record<string, number>;
  readonly table: Table;
  readonly regions: Regions;
  readonly placed: Placement;
  /** Whether all of the values buffer is written, not only what `placed` says changed. */
  readonly stale: boolean;
  readonly mirrors: Mirrors;
  readonly timings: Timings;
  readonly reads: Reads<I>;
}

/**
 * Writes a fold's buffers, binds them, dispatches the kernel over every subject, and sets where
 * each channel's values land in `outputs`. Returns the output buffer.
 */
export function submit<I>(s: Submission<I>, outputs: Map<string, GpuChannel>): GpuBuffer {
  const { device: dev, buffers: buf, kernel: k, table, regions } = s;
  const n = s.list.length;
  buf.subjects(s.list, s.fieldsOf, k.fields);
  const t = buf.sized('table', table.rows.byteLength, Usage.STORAGE | Usage.COPY_DST);
  const had = buf.of('values');
  const v = buf.sized('values', regions.length * 4, Usage.STORAGE | Usage.COPY_DST);
  const f = buf.sized('frame', 16, Usage.UNIFORM | Usage.COPY_DST);
  const out = buf.sized('out', k.size * 4, Usage.STORAGE | Usage.COPY_SRC);
  const hadSub = buf.of('persub');
  const persub = buf.sized(
    'persub',
    (s.mirrors.length + s.timings.length + s.reads.length) * 4,
    Usage.STORAGE | Usage.COPY_DST,
  );
  dev.queue.writeBuffer(t, 0, table.rows);
  const data = regions.data;
  if (s.stale || v !== had) {
    if (regions.length > 0) dev.queue.writeBuffer(v, 0, data.subarray(0, regions.length));
  } else
    for (const [from, to] of s.placed.changed)
      dev.queue.writeBuffer(v, from, data.subarray(from / 4, to / 4));
  s.mirrors.upload(dev, persub, persub !== hadSub);
  s.timings.upload(dev, persub, persub !== hadSub);
  s.reads.upload(dev, persub);
  dev.queue.writeBuffer(f, 0, new Uint32Array([table.count, n, 0, 0]));
  const group = buf.bind(s.pipeline, layoutOf(dev));
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(s.pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(n / GROUP));
  pass.end();
  dev.queue.submit([enc.finish()]);
  for (const o of k.outputs)
    outputs.set(o.name, { buffer: out, offset: o.offset * 4, stride: o.axes * 4, axes: o.axes });
  return out;
}
