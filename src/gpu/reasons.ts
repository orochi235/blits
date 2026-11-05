import type { Voice } from '../voice.js';
import { warnOnce } from '../warn.js';

/**
 * Why the gpu engine's last fold left channels on the CPU: a voice's `name` (undefined where it has
 * none, or where the whole fold stayed there), the channels, and why.
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
  private why: readonly GpuReason[] = Object.freeze([]);

  /** The last fold's reasons. */
  get list(): readonly GpuReason[] {
    return this.why;
  }

  /** Records a fold's reasons, warning about each the first time it is given. */
  note<I>(reasons: readonly { voice: Voice<I, unknown>; why: string }[]): void {
    this.why = Object.freeze(
      reasons.map((r) =>
        entry(r.voice.spec.name, r.voice.patch.writes as readonly string[], r.why),
      ),
    );
    for (const r of reasons) {
      const key = `${(r.voice.patch.writes as readonly string[]).join(',')}: ${r.why}`;
      if (this.told.has(key)) continue;
      this.told.add(key);
      warnOnce(r.voice, `${key}, so the gpu engine leaves it on the CPU`);
    }
  }

  /** Adds a reason the whole fold stayed on the CPU, keeping `channels` there, warned once. */
  all(channels: readonly string[], why: string): void {
    this.why = Object.freeze([...this.why, entry(undefined, channels, why)]);
    if (this.told.has(why)) return;
    this.told.add(why);
    warnOnce({}, why);
  }

  clear(): void {
    this.why = Object.freeze([]);
  }
}

function entry(voice: string | undefined, channels: readonly string[], why: string): GpuReason {
  return Object.freeze({ voice, channels: Object.freeze([...channels]), why });
}
