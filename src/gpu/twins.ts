import type { Mixer } from '../mixer.js';
import { production, warnOnce } from '../warn.js';
import type { Kernel } from './kernel.js';
import type { Runner } from './runner.js';
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
  const check = () => {
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
              `the GPU runner writing ${o.name} gives ${g} on the GPU and ${w} on the CPU for subject ${i}; the runner and the patch's JS disagree`,
            );
        }
      });
  };
  // A device lost before the map settles refuses it; the check is dropped.
  read.mapAsync(MAP_READ).then(check, () => {});
}

/** Runs `twins` in development the first time each runner folds. */
export class Twins {
  private readonly checked = new Set<string>();

  /** Checks the fold `k` wrote to `out` against the CPU where one of `runners` has not run before. */
  first<I>(
    device: GpuDevice,
    mix: Mixer<I, unknown>,
    list: readonly I[],
    k: Kernel,
    out: GpuBuffer,
    runners: readonly Runner[],
  ): void {
    if (production()) return;
    const fresh = runners.filter((r) => !this.checked.has(r.key));
    if (fresh.length === 0) return;
    for (const r of fresh) this.checked.add(r.key);
    twins(device, mix, list, k, out, fresh[0] as Runner);
  }
}
