import type { Voice } from '../voice.js';
import { warnOnce } from '../warn.js';

/**
 * A voice the gpu engine's last fold left on the CPU: its `name` (undefined where it has none), the
 * channels it writes, and why.
 *
 * @category gpu
 */
export interface GpuReason {
  readonly voice: string | undefined;
  readonly channels: readonly string[];
  readonly why: string;
}

/** Why the last fold left each voice on the CPU, each reason warned once in development. */
export class Reasons {
  /** Each channel's reason for staying on the CPU, said once. */
  private readonly told = new Set<string>();
  private why: readonly GpuReason[] = [];

  /** The last fold's reasons. */
  get list(): readonly GpuReason[] {
    return this.why;
  }

  /** Records a fold's reasons, warning about each the first time it is given. */
  note<I>(reasons: readonly { voice: Voice<I, unknown>; why: string }[]): void {
    this.why = reasons.map((r) => ({
      voice: r.voice.spec.name,
      channels: [...(r.voice.patch.writes as readonly string[])],
      why: r.why,
    }));
    for (const r of reasons) {
      const key = `${(r.voice.patch.writes as readonly string[]).join(',')}: ${r.why}`;
      if (this.told.has(key)) continue;
      this.told.add(key);
      warnOnce(r.voice, `${key}, so the gpu engine leaves it on the CPU`);
    }
  }
}
