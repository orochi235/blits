import { oklab } from '@msb235/blits';
import type { Board, Led } from '../../board.js';
import { rgb } from '../../color.js';
import { afflictions, type Defect } from '../../defects.js';
import { FADE, type Fade, type Ghost } from '../../optics.js';
import { hashThreshold } from '../wgsl-hash.js';
import { BUFFER } from './usage.js';
import { GROUP, OPTICS_WGSL, SHOWS } from './wgsl-optics.js';

/** `createOpticsFrame` on the GPU, reading poses from a buffer and writing what each light shows. */
export interface GpuOptics {
  /** Five numbers per light: shine, r, g, b (sRGB, 0..1) and bloom, as `Lit` holds them. */
  readonly shows: GPUBuffer;
  /** Records a step of `dt` ms into `enc`. */
  step(enc: GPUCommandEncoder, fallback: number, dt: number, brightness: number): void;
  setDefects(defects: readonly Defect[]): void;
  setFade(fade: Fade): void;
  setGhost(ghost: Ghost): void;
  destroy(): void;
}

/** Each entry point, in dispatch order, and the bindings it reads: `layout: 'auto'` leaves out the rest. */
const USES: Record<string, readonly number[]> = {
  settle_main: [0, 1, 2, 3],
  lines_main: [0, 3, 4],
  show_main: [0, 1, 2, 3, 4, 5],
};

/** The optics for `leds` on `b`, dots first, reading each light's pose from `pose`. */
export function createGpuOptics(
  device: GPUDevice,
  b: Board,
  leds: readonly Led[],
  pose: GPUBuffer,
): GpuOptics {
  const n = leds.length;
  const usage = BUFFER.STORAGE | BUFFER.COPY_DST;
  const buffer = (bytes: number, use: number, label: string) =>
    device.createBuffer({ size: Math.max(16, bytes), usage: use, label: `bree ${label}` });
  const faults = buffer(n * 16, usage, 'faults');
  const shown = buffer(n * 4, usage, 'shown');
  const lines = buffer((b.rows + b.cols) * 4, usage, 'lines');
  const shows = buffer(n * SHOWS * 4, BUFFER.STORAGE | BUFFER.COPY_SRC, 'shows');
  const uniform = buffer(80, BUFFER.UNIFORM | BUFFER.COPY_DST, 'optics');
  const head = new ArrayBuffer(80);
  const u32 = new Uint32Array(head);
  const f32 = new Float32Array(head);
  u32.set([n, b.dots.length, b.cols, b.rows]);
  const module = device.createShaderModule({ code: OPTICS_WGSL });
  const pipes = Object.entries(USES).map(([entryPoint, uses]) => {
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
    const all = [uniform, pose, faults, shown, lines, shows];
    const group = device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: uses.map((binding) => ({
        binding,
        resource: { buffer: all[binding] as GPUBuffer },
      })),
    });
    return { pipe, group };
  });
  let fade: Fade = FADE;
  let ghost: Ghost = {};
  let clock = 0;
  let fallbackHex = Number.NaN;

  const self: GpuOptics = {
    shows,
    step(enc, fallback, dt, brightness) {
      clock += dt;
      const t = clock / 1000;
      // The split keeps the clock's bits past f32's 24, but each product with the rate still rounds
      // to f32, so a flicker step within a few ulps of a whole number can land either side of it.
      const hi = Math.fround(t);
      f32.set(
        [
          dt,
          brightness,
          fade.rise ?? FADE.rise,
          fade.fall ?? FADE.fall,
          hi,
          t - hi,
          ghost.row ?? 0,
          ghost.col ?? 0,
        ],
        4,
      );
      if (fallback !== fallbackHex) {
        fallbackHex = fallback;
        const lab = oklab(fallback);
        f32.set([lab[0] ?? 0, lab[1] ?? 0, lab[2] ?? 0, 1], 12);
        f32.set([...rgb(fallback).map((v) => v * 255), 255], 16);
      }
      device.queue.writeBuffer(uniform, 0, head);
      if (n === 0) return;
      const pass = enc.beginComputePass();
      const counts = [n, b.rows + b.cols, n];
      pipes.forEach(({ pipe, group }, k) => {
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(Math.ceil((counts[k] as number) / GROUP));
      });
      pass.end();
    },
    setDefects(defects) {
      const a = afflictions(leds, defects);
      const data = new ArrayBuffer(n * 16);
      const f = new Float32Array(data);
      const u = new Uint32Array(data);
      for (let i = 0; i < n; i++) {
        const at = hashThreshold(a.duty[i] ?? 1);
        // A duty no hash reaches never drops out, whatever its rate.
        const never = at > 0xffff_ffff;
        f[i * 4] = a.scale[i] ?? 1;
        f[i * 4 + 1] = a.floor[i] ?? 0;
        f[i * 4 + 2] = never ? 0 : (a.rate[i] ?? 0);
        u[i * 4 + 3] = never ? 0 : at;
      }
      device.queue.writeBuffer(faults, 0, data);
    },
    setFade(next) {
      fade = next;
    },
    setGhost(next) {
      ghost = next;
    },
    destroy() {
      for (const buf of [faults, shown, lines, shows, uniform]) buf.destroy();
    },
  };
  self.setDefects([]);
  return self;
}
