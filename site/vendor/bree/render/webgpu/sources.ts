import type { GpuChannel } from '@msb235/blits/gpu';
import type { Board } from '../../board.js';
import { axesOf, CHANNELS, type SignColumns } from '../../optics.js';
import { PLANES, type Plane } from '../../planes.js';
import { BUFFER } from './usage.js';
import { GATHER_WGSL, GROUP, POSE, SLOT } from './wgsl-optics.js';

/** Where the GPU folds a mix's channels: `gpuOf(m)` is one. */
export interface ChannelSource {
  channel(name: keyof SignColumns): GpuChannel | null;
}

/** Another sign's poses to lay over this one's dots: `map` gives, per dot, the light it copies. */
export interface Follow {
  readonly lit: GPUBuffer;
  readonly map: Uint32Array;
  readonly planes: readonly Plane[];
}

/** Every light's pose, gathered on the GPU each frame from the mix's buffers or its columns. */
export interface Sources {
  /** Ten numbers per light, `SLOT` placing each channel. */
  readonly pose: GPUBuffer;
  /** Records this frame's gather into `enc`, uploading what `source` leaves to the CPU. */
  gather(enc: GPUCommandEncoder, cols: SignColumns, source: ChannelSource | null): void;
  setHighlight(mask: Uint8Array | null): void;
  setFollow(from: Follow | null): void;
  destroy(): void;
}

/**
 * Gathers poses for `b`'s lights, dots then bulbs. A source's subjects are the dots then the
 * cells, so bulb `j` reads subject `dots + cellOf[j]`; the columns are already in light order.
 */
export function createSources(device: GPUDevice, b: Board): Sources {
  const STORAGE_IN = BUFFER.STORAGE | BUFFER.COPY_DST;
  const dots = b.dots.length;
  const n = dots + b.bulbs.length;
  const buffer = (bytes: number, usage: number, label: string) =>
    device.createBuffer({ size: Math.max(16, bytes), usage, label: `bree ${label}` });
  const pose = buffer(n * POSE * 4, BUFFER.STORAGE | BUFFER.COPY_SRC, 'pose');
  const cpu = buffer(n * POSE * 4, STORAGE_IN, 'columns');
  const staging = new Float32Array(n * POSE);
  const info = new Uint32Array(n * 4);
  for (let i = 0; i < n; i++) info[i * 4] = i < dots ? i : dots + (b.cellOf[i - dots] as number);
  const infoBuf = buffer(info.byteLength, STORAGE_IN, 'light info');
  device.queue.writeBuffer(infoBuf, 0, info);
  const uniform = buffer(16 + 7 * 16, BUFFER.UNIFORM | BUFFER.COPY_DST, 'gather');
  const head = new Uint32Array(4 + 7 * 4);
  const empty = buffer(16, BUFFER.STORAGE, 'nothing');
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: GATHER_WGSL }), entryPoint: 'main' },
  });
  let follow: Follow | null = null;
  let group: { src: GPUBuffer; from: GPUBuffer; group: GPUBindGroup } | null = null;

  const bindings = (src: GPUBuffer, from: GPUBuffer) => {
    if (group?.src === src && group.from === from) return group.group;
    const made = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [uniform, src, cpu, infoBuf, from, pose].map((b, binding) => ({
        binding,
        resource: { buffer: b },
      })),
    });
    group = { src, from, group: made };
    return made;
  };

  return {
    pose,
    gather(enc, cols, source) {
      let src: GPUBuffer | null = null;
      head[0] = n;
      head[1] = dots;
      head[2] = follow ? followMask(follow.planes) : 0;
      for (const [c, on] of planOf(source).entries()) {
        const name = CHANNELS[c] as (typeof CHANNELS)[number];
        const axes = axesOf(name);
        const base = n * SLOT[name];
        if (on) {
          src = on.buffer as GPUBuffer;
          head.set([1, on.offset / 4, on.stride / 4, 0], 4 + c * 4);
          continue;
        }
        head.set([0, base, axes, 0], 4 + c * 4);
        const col = cols[name];
        for (let k = 0; k < n * axes; k++) staging[base + k] = col[k] ?? 0;
        device.queue.writeBuffer(cpu, base * 4, staging, base, n * axes);
      }
      device.queue.writeBuffer(uniform, 0, head);
      if (n === 0) return;
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings(src ?? empty, follow?.lit ?? empty));
      pass.dispatchWorkgroups(Math.ceil(n / GROUP));
      pass.end();
    },
    setHighlight(mask) {
      for (let i = 0; i < dots; i++) info[i * 4 + 1] = mask?.[i] ? 1 : 0;
      device.queue.writeBuffer(infoBuf, 0, info);
    },
    setFollow(from) {
      follow = from;
      for (let i = 0; i < dots; i++) info[i * 4 + 2] = from?.map[i] ?? 0;
      device.queue.writeBuffer(infoBuf, 0, info);
    },
    destroy() {
      for (const b of [pose, cpu, infoBuf, uniform, empty]) b.destroy();
    },
  };
}

/**
 * Where a gather reads each channel this frame, in `CHANNELS` order: `source`'s buffer, or null
 * for the columns. The channels read from the GPU must all share one buffer.
 */
export function planOf(source: ChannelSource | null): (GpuChannel | null)[] {
  let src: unknown = null;
  return CHANNELS.map((name) => {
    const on = source?.channel(name) ?? null;
    if (!on?.buffer || on.offset % 4 !== 0 || (src !== null && src !== on.buffer)) return null;
    src = on.buffer;
    return on;
  });
}

/** One bit per pose number the followed planes carry. */
function followMask(planes: readonly Plane[]): number {
  let mask = 0;
  for (const plane of planes)
    for (const c of PLANES[plane]) {
      const slot = SLOT[c];
      for (let a = 0; a < axesOf(c); a++) mask |= 1 << (slot + a);
    }
  return mask;
}
