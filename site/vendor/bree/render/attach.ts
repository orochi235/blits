import type { Engine, Mix } from '@msb235/blits';
import { type GpuDevice, gpu as gpuEngine, gpuOf } from '@msb235/blits/gpu';
import type { Board, Led, Pose, Subject } from '../board.js';
import { createSign2d, paintBulbs, type Shape, type Sign, type SignColumns } from '../draw.js';
import type { Grid } from '../grid.js';
import { fieldsOf } from '../modulators/shader.js';
import { CHANNELS } from '../optics.js';
import { type Backend, pickBackend } from './backend.js';
import type { Gpu } from './gpu.js';
import type { Housing } from './housing.js';
import { boardLights, type SignLights } from './sign-lights.js';
import { createWebGlSignOf } from './webgl/sign.js';
import { type ChannelSource, createWebGpuSignOf, type WebGpuSign } from './webgpu/sign.js';
import { BUFFER } from './webgpu/usage.js';
import { POSE } from './webgpu/wgsl-optics.js';

type Channel = keyof SignColumns;
const EVERY: ReadonlySet<Channel> = new Set(CHANNELS);

/** What a marquee draws with, and how its mix feeds it. */
export interface Drawing {
  /** What it draws with; '2d' when it draws nothing. */
  readonly backend: Backend;
  readonly sign: Sign | null;
  /** The sign, when WebGPU draws it. */
  readonly webgpu: WebGpuSign | null;
  /** The device a WebGPU sign draws on. */
  readonly device: GPUDevice | null;
  /** The engine its mix runs on: blits's gpu engine under WebGPU, else the stock one. */
  readonly engine: Engine | undefined;
  /** Whether it has been destroyed. */
  readonly gone: boolean;
  /** Hands the GPU side `m`, once made, with the dots then the cells as its subjects. */
  bind(m: Mix<Subject, Pose>): void;
  /** Draws other lights from now on, the GPU side folding their board's dots and cells. */
  reshape(next: Shape): void;
  /** The channels the next render reads from the columns, which the frame must pull. */
  cpuChannels(): ReadonlySet<Channel>;
  /** Keeps `channels` on the CPU whatever the mix folds on the GPU, for a follow laid there. */
  keep(channels: readonly Channel[]): void;
  /**
   * The WebGPU sign's poses as a read some frames back left them, `POSE` numbers a light, and
   * starts the next read; null until one has landed, or without a WebGPU sign.
   */
  poses(): Float32Array | null;
  destroy(): void;
}

export interface DrawingOptions {
  readonly draw: boolean;
  readonly backend: Backend | undefined;
  readonly gpu: Gpu | null | undefined;
  readonly housing: Housing;
  readonly grid: Grid;
  /** What to draw, where it isn't the board's dots and bulbs on `grid`. */
  readonly lights?: SignLights;
}

const canWebgl = () => typeof WebGL2RenderingContext !== 'undefined';

/**
 * Picks a backend for `canvas` and makes its sign: WebGPU with a handle, else WebGL where the page
 * has a context to give, else 2D. Asked for WebGL, or for nothing, where no WebGL sign can be made,
 * it draws with 2D.
 */
export function attach(
  canvas: HTMLCanvasElement,
  b: Board,
  leds: readonly Led[],
  opts: DrawingOptions,
): Drawing {
  let side: ChannelSource | null = null;
  const kept = new Set<Channel>();
  const source: ChannelSource = {
    channel: (name) => (side && !kept.has(name) ? side.channel(name) : null),
  };
  const picked = pickBackend(opts.backend, opts.gpu, canWebgl);
  const want = opts.draw ? picked : '2d';
  let backend: Backend = '2d';
  let sign: Sign | null = null;
  let webgpu: WebGpuSign | null = null;
  const lights = opts.lights ?? boardLights(b, leds, opts.grid);
  if (want === 'webgpu' && opts.gpu) {
    webgpu = createWebGpuSignOf(canvas, lights, opts.gpu, source, opts.housing);
    sign = webgpu;
    backend = 'webgpu';
  } else if (want === 'webgl') {
    sign = createWebGlSignOf(canvas, lights, opts.housing);
    if (sign) backend = 'webgl';
  }
  if (opts.draw && !sign) sign = createSign2d(canvas, lights, opts.housing);
  let subjects: readonly Subject[] = [...b.dots, ...b.cells];
  let mix: Mix<Subject, Pose> | null = null;
  const device = webgpu && opts.gpu ? opts.gpu.device : null;
  const read = device && webgpu ? readback(device, webgpu.output, leds.length) : null;
  let gone = false;

  return {
    backend,
    sign,
    webgpu,
    device,
    engine: device ? gpuEngine({ device: device as unknown as GpuDevice }) : undefined,
    get gone() {
      return gone;
    },
    bind(m) {
      mix = m;
      if (!device) return;
      const gpuSide = gpuOf(m);
      gpuSide.subjects(subjects, fieldsOf);
      side = gpuSide;
    },
    reshape(next) {
      subjects = [...next.board.dots, ...next.board.cells];
      sign?.reshape(next);
      if (device && mix) gpuOf(mix).subjects(subjects, fieldsOf);
    },
    cpuChannels: () => webgpu?.cpuChannels() ?? EVERY,
    keep(channels) {
      kept.clear();
      for (const c of channels) kept.add(c);
    },
    poses: () => (gone ? null : (read?.next() ?? null)),
    destroy() {
      gone = true;
      sign?.destroy();
      read?.destroy();
    },
  };
}

/** Reads `output`'s poses back, one read in flight at a time, giving the last that landed. */
function readback(
  device: GPUDevice,
  output: GPUBuffer,
  n: number,
): { next(): Float32Array | null; destroy(): void } {
  const bytes = Math.max(16, n * POSE * 4);
  let staging: GPUBuffer | null = null;
  let reading = false;
  let last: Float32Array | null = null;
  const next = () => {
    if (reading) return last;
    reading = true;
    try {
      staging ??= device.createBuffer({
        size: bytes,
        usage: BUFFER.MAP_READ | BUFFER.COPY_DST,
        label: 'bree poses read back',
      });
      const into = staging;
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(output, 0, into, 0, bytes);
      device.queue.submit([enc.finish()]);
      into.mapAsync(BUFFER.MAP_READ).then(
        () => {
          last = new Float32Array(into.getMappedRange().slice(0));
          into.unmap();
          reading = false;
        },
        () => {
          reading = false;
        },
      );
    } catch {
      reading = false;
    }
    return last;
  };
  return { next, destroy: () => staging?.destroy() };
}

/** The columns `cols` holds of `channels`: all of it when that is every channel. */
function only(cols: SignColumns, channels: ReadonlySet<Channel>): Partial<SignColumns> {
  if (channels.size === CHANNELS.length) return cols;
  const out: Partial<Record<Channel, Float64Array>> = {};
  for (const c of channels) out[c] = cols[c];
  return out;
}

/**
 * Pulls `channels` of the dots into `cols` and of the cells into `cells`, and paints the bulbs
 * those channels from their cells; nothing when no channel is left on the CPU.
 */
export function pullChannels(
  m: Mix<Subject, Pose>,
  b: Board,
  cols: SignColumns,
  cells: SignColumns,
  channels: ReadonlySet<Channel>,
): void {
  if (channels.size === 0) return;
  m.pull(b.dots, only(cols, channels));
  m.pull(b.cells, only(cells, channels));
  paintBulbs(b, cells, cols, channels);
}

/**
 * Starts reading back each channel the GPU folds, and when one lands, lays it over the dots in
 * `cols` and the cells in `cells`, painting the bulbs from their cells. A read lands a frame behind;
 * one landing after its channel moved to the CPU, or after `gone()`, is dropped. Nothing on a blits
 * without `read`.
 */
export function readChannels(
  m: Mix<Subject, Pose>,
  b: Board,
  cols: SignColumns,
  cells: SignColumns,
  drawing: Pick<Drawing, 'cpuChannels' | 'gone'>,
): void {
  const side = gpuOf(m) as { read?: (name: string) => Promise<Landed | null> };
  if (!side.read) return;
  const dots = b.dots.length;
  const onCpu = drawing.cpuChannels();
  for (const c of CHANNELS) {
    if (onCpu.has(c)) continue;
    void side.read(c).then((r) => {
      if (!r || drawing.gone || drawing.cpuChannels().has(c)) return;
      if (r.subjects.length !== dots + b.cells.length) return;
      const n = r.axes;
      cols[c].set(r.values.subarray(0, dots * n));
      cells[c].set(r.values.subarray(dots * n));
      paintBulbs(b, cells, cols, [c]);
    });
  }
}

/** What a read of a channel gives: its values, `axes` numbers a subject, in `subjects`' order. */
type Landed = { values: Float32Array; axes: number; subjects: readonly unknown[] };

/** Registered drawings, by the marquee that owns each, for a follower to find its source's. */
const drawings = new WeakMap<object, Drawing>();

export function register(owner: object, drawing: Drawing): void {
  drawings.set(owner, drawing);
}

export function drawingOf(owner: object): Drawing | undefined {
  return drawings.get(owner);
}
