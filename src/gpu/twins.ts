import type { Mixer } from '../mixer.js';
import { warnOnce } from '../warn.js';
import type { Kernel } from './kernel.js';
import { type GpuBuffer, type GpuDevice, MAP_READ, Usage } from './webgpu.js';

/** Twin check tolerances: what f32 math and the order of its operations leave apart from f64. */
const RELATIVE = 1e-4;
/** Absolute tolerance: a color's trip through linear sRGB and back leaves about 4e-4 in f32. */
const ABSOLUTE = 1e-3;
const SAMPLES = 16;

/**
 * Compares a sample of `list`'s subjects in the fold `k` wrote to `out` with the CPU's, warning
 * about `about` where they disagree.
 */
export function twins<I>(
  device: GpuDevice,
  mix: Mixer<I, unknown>,
  list: readonly I[],
  k: Kernel,
  out: GpuBuffer,
  about: object,
): void {
  const n = list.length;
  const picks = [
    ...new Set(
      Array.from({ length: Math.min(SAMPLES, n) }, (_, j) =>
        Math.floor((j * (n - 1)) / Math.max(1, SAMPLES - 1)),
      ),
    ),
  ];
  const read = device.createBuffer({
    size: k.size * 4,
    usage: Usage.MAP_READ | Usage.COPY_DST,
  });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(out, 0, read, 0, k.size * 4);
  device.queue.submit([enc.finish()]);
  const subjects = picks.map((i) => list[i] as I);
  const cpu = subjects.map((s) => ({ ...(mix.probe(s) as Record<string, unknown>) }));
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
              about,
              `a shader patch writing ${o.name} gives ${g} on the GPU and ${w} on the CPU for subject ${i}; its wgsl and at disagree`,
            );
        }
      });
  });
}
