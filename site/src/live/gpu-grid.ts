import { type GpuChannel, type GpuDevice, type GpuSide, OVER_WGSL } from '@msb235/blits/gpu';

// The site's per-pixel demos draw a grid of cells, one subject a pixel, from a mix the gpu engine
// folds. Without WebGPU they keep their own CPU drawing; with it, every frame goes through the
// shader here, from the GPU's buffers or, for a channel the GPU is not folding this frame, from
// values the demo probed on the CPU and the grid uploads in the same layout.

interface Navigator {
  gpu?: {
    requestAdapter(): Promise<{ requestDevice(): Promise<GpuDevice> } | null>;
    getPreferredCanvasFormat(): string;
  };
}
const nav = () => navigator as unknown as Navigator;

let shared: Promise<GpuDevice | null> | undefined;

/**
 * The page's WebGPU device, or null where there is none. `?engine=cpu` asks for none, so a demo
 * can be compared with its CPU drawing.
 */
export function gpuDevice(): Promise<GpuDevice | null> {
  if (new URLSearchParams(location.search).get('engine') === 'cpu') return Promise.resolve(null);
  shared ??= (async () => {
    try {
      const adapter = await nav().gpu?.requestAdapter();
      return adapter ? await adapter.requestDevice() : null;
    } catch {
      return null;
    }
  })();
  return shared;
}

/** One channel the grid reads: its name, and how many numbers a cell's value takes. */
export interface GridChannel {
  name: string;
  axes: number;
}

export interface GridSpec<I> {
  canvas: HTMLCanvasElement;
  cols: number;
  rows: number;
  device: GpuDevice;
  side: GpuSide<I>;
  channels: readonly GridChannel[];
  /** Each cell's base color as 0xrrggbb, in cell order. */
  bases: ArrayLike<number>;
  /**
   * WGSL setting `shown` (linear sRGB) for cell `i` from `under` (its base, linear sRGB).
   * `c_<name>(i, a)` reads axis `a` of a channel's value and `c4_<name>(i)` its first four.
   */
  body: string;
  /** Fills `out` with a channel's values for every cell, probed on the CPU, `axes` a cell. */
  cpu(name: string, out: Float32Array): void;
}

export interface Grid {
  /** Draws this frame. */
  draw(): void;
  destroy(): void;
}

type Buf = ReturnType<GpuDevice['createBuffer']>;
interface Raw {
  createRenderPipeline(desc: unknown): unknown;
  createBindGroupLayout(desc: unknown): unknown;
  createPipelineLayout(desc: unknown): unknown;
  createBindGroup(desc: unknown): unknown;
  createCommandEncoder(): {
    beginRenderPass(desc: unknown): {
      setPipeline(p: unknown): void;
      setBindGroup(i: number, g: unknown): void;
      draw(n: number): void;
      end(): void;
    };
    finish(): unknown;
  };
}

/** A grid drawn by WebGPU into `canvas`, a pixel a cell; size the canvas with CSS. */
export function gpuGrid<I>(spec: GridSpec<I>): Grid {
  const { canvas, cols, rows, device, side, channels } = spec;
  const n = cols * rows;
  const raw = device as unknown as Raw;
  const ctx = canvas.getContext('webgpu') as unknown as {
    configure(c: unknown): void;
    getCurrentTexture(): { createView(): unknown };
  };
  const format = nav().gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm';
  ctx.configure({ device, format, alphaMode: 'opaque' });
  canvas.width = cols;
  canvas.height = rows;

  const bases = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = spec.bases[i] ?? 0;
    bases.set([(c >> 16) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255, 0], i * 4);
  }
  const baseBuf = device.createBuffer({ size: bases.byteLength, usage: 0x80 | 0x08 });
  device.queue.writeBuffer(baseBuf, 0, bases);
  const fallbacks = channels.map((c) => ({
    data: new Float32Array(n * c.axes),
    buf: device.createBuffer({ size: n * c.axes * 4, usage: 0x80 | 0x08 }),
  }));

  const decls = channels
    .map(
      (c, k) => `@group(0) @binding(${2 + k}) var<storage, read> ch_${k}: array<f32>;
fn c_${c.name}(i: u32, a: u32) -> f32 { return ch_${k}[grid.at[${k}].x + i * grid.at[${k}].y + a]; }
fn c4_${c.name}(i: u32) -> vec4f { return vec4f(c_${c.name}(i, 0u), c_${c.name}(i, 1u), c_${c.name}(i, 2u), c_${c.name}(i, 3u)); }`,
    )
    .join('\n');
  const code = `${OVER_WGSL}
struct Grid { size: vec4u, at: array<vec4u, ${Math.max(1, channels.length)}> }
@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> bases: array<vec4f>;
${decls}
@vertex fn vs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[v], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let i = u32(pos.y) * grid.size.x + u32(pos.x);
  let under = blits_decode(bases[i].xyz);
  var shown = under;
  ${spec.body}
  return vec4f(blits_encode(shown), 1.0);
}`;
  // The meta uniform: the grid's width, then each channel's offset and stride in f32s.
  const metaData = new Uint32Array(4 + 4 * Math.max(1, channels.length));
  metaData[0] = cols;
  const meta = device.createBuffer({ size: metaData.byteLength, usage: 0x40 | 0x08 });
  const module = device.createShaderModule({ code, label: 'gpu grid' });
  // An explicit layout: 'auto' would drop the binding of a channel the body never reads.
  const FRAGMENT = 2;
  const layout = raw.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: FRAGMENT, buffer: { type: 'uniform' } },
      ...[0, ...channels.map((_, k) => k + 1)].map((k) => ({
        binding: 1 + k,
        visibility: FRAGMENT,
        buffer: { type: 'read-only-storage' },
      })),
    ],
  });
  const pipeline = raw.createRenderPipeline({
    layout: raw.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  return {
    draw() {
      const sources: Buf[] = channels.map((c, k) => {
        const on: GpuChannel | null = side.channel(c.name);
        const f = fallbacks[k] as { data: Float32Array; buf: Buf };
        if (on !== null) {
          metaData[4 + 4 * k] = on.offset / 4;
          metaData[5 + 4 * k] = on.stride / 4;
          return on.buffer;
        }
        spec.cpu(c.name, f.data);
        device.queue.writeBuffer(f.buf, 0, f.data);
        metaData[4 + 4 * k] = 0;
        metaData[5 + 4 * k] = c.axes;
        return f.buf;
      });
      device.queue.writeBuffer(meta, 0, metaData);
      const group = raw.createBindGroup({
        layout,
        entries: [meta, baseBuf, ...sources].map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
      });
      const enc = raw.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 1],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    destroy() {
      baseBuf.destroy();
      meta.destroy();
      for (const f of fallbacks) f.buf.destroy();
    },
  };
}

/**
 * A grid's `cpu`: probes every cell on the CPU and copies a channel's values out, `axes` a cell, for
 * a frame the GPU is not folding that channel.
 */
export function probed<I>(
  m: { probe(subject: I, out?: object): object },
  cells: readonly I[],
): (name: string, out: Float32Array) => void {
  const pose: Record<string, unknown> = {};
  return (name, out) => {
    const axes = out.length / cells.length;
    cells.forEach((c, i) => {
      m.probe(c, pose);
      const v = pose[name];
      if (typeof v === 'number') out[i] = v;
      else for (let a = 0; a < axes; a++) out[i * axes + a] = (v as number[])[a] ?? 0;
    });
  };
}

/** WGSL laying cell `i`'s stack in channel `name` over the color in `v`, in place, as `toHex` does. */
export function layStack(name: string, v: string): string {
  return `{
    let n = u32(c_${name}(i, 1u));
    let t = c_${name}(i, 0u);
    for (var k = 0u; k < n; k++) {
      let at = 2u + 4u * k;
      ${v} = blits_lay(t, ${v}, vec4f(c_${name}(i, at), c_${name}(i, at + 1u), c_${name}(i, at + 2u), c_${name}(i, at + 3u)));
    }
    ${v} = blits_clip(${v});
  }`;
}
