import type { Mixer } from '../mixer.js';
import { errorOnce, production, warnOnce } from '../warn.js';
import type { Kernel } from './kernel.js';
import { mapCopy, staging } from './readback.js';
import type { Runner } from './runner.js';
import type { GpuBuffer, GpuDevice } from './webgpu.js';

/** Twin check tolerances: what f32 math and the order of its operations leave apart from f64. */
const RELATIVE = 1e-4;
/** Absolute tolerance: a color's trip through linear sRGB and back leaves about 4e-4 in f32. */
const ABSOLUTE = 1e-3;
const SAMPLES = 16;

/** The CPU's values for a sample of the registered subjects, by their place in the list. */
export interface Sample {
  readonly picks: readonly number[];
  readonly cpu: readonly Record<string, unknown>[];
  /** The runners not checked before, the first of them the one warnings are about. */
  readonly fresh: readonly Runner[];
}

/**
 * The CPU's values for a sample of `list`'s subjects. Taken before the fold, since probing commits
 * a motion's changes, and a fold made before that would be out of date as soon as it was made.
 */
function sample<I>(mix: Mixer<I, unknown>, list: readonly I[], fresh: readonly Runner[]): Sample {
  const n = list.length;
  const picks = [
    ...new Set(
      Array.from({ length: Math.min(SAMPLES, n) }, (_, j) =>
        Math.floor((j * (n - 1)) / Math.max(1, SAMPLES - 1)),
      ),
    ),
  ];
  const cpu = picks.map((i) => ({ ...(mix.probe(list[i] as I) as Record<string, unknown>) }));
  return { picks, cpu, fresh };
}

/** Compares `s` with the fold `k` wrote to `out`, warning where they disagree. */
function compare(device: GpuDevice, k: Kernel, out: GpuBuffer, s: Sample): void {
  const about = s.fresh[0] as Runner;
  const read = staging(device, k.size * 4, 'blits gpu twins');
  const check = () => {
    const got = new Float32Array(read.getMappedRange().slice(0));
    for (const o of k.outputs)
      s.picks.forEach((i, j) => {
        const want = s.cpu[j]?.[o.name];
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
  mapCopy(device, read, [{ from: out, offset: 0, at: 0, bytes: k.size * 4 }], (mapped) => {
    try {
      if (mapped) check();
    } catch (err) {
      errorOnce(about, `a gpu twin check could not read its values back: ${err}`);
    } finally {
      read.destroy();
    }
  });
}

/** Checks, in development, the first fold of each runner against the CPU. */
export class Twins {
  private readonly checked = new Set<string>();

  /** The CPU's sample for a fold of `runners`, before it is made; null where none is new. */
  before<I>(mix: Mixer<I, unknown>, list: readonly I[], runners: readonly Runner[]): Sample | null {
    if (production()) return null;
    const fresh = runners.filter((r) => !this.checked.has(r.key));
    return fresh.length === 0 ? null : sample(mix, list, fresh);
  }

  /** Checks the fold `k` wrote to `out` against `s`. */
  after(device: GpuDevice, k: Kernel, out: GpuBuffer, s: Sample | null): void {
    if (s === null) return;
    for (const r of s.fresh) this.checked.add(r.key);
    compare(device, k, out, s);
  }
}
